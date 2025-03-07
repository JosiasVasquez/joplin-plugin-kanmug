import joplin from "api";
import * as yaml from "js-yaml";
import { Action, InsertNoteToColumnAction } from "./actions";
import Board from "./board";
import { BoardState, Config, NoteDataMonad } from "./types";
import { RecentKanbanStore } from "./recentKanbanStore";
import { Debouncer } from "./utils/debouncer";
import { JoplinService } from "./services/joplinService";
import {
    executeUpdateQuery, getAllNotebooks, getAllTags, getConfigNote, searchNotes, setConfigNote,
} from "./noteData";
import { getYamlConfig, parseConfigNote } from "./parser";
import { LinkParser, LinkType } from "./utils/linkParser";
import { AsyncQueue } from "./utils/asyncQueue";
import { ConfigUIData } from "./configui";
import { getRuleEditorTypes } from "./rules";
import { getMdList, getMdTable } from "./markdown";

const REFRESH_UI_DEBOUNCE_MS = 100;

export class KanbanApp {
    openBoard: Board | undefined = undefined;

    boardView: string | null = null;

    recentKanbanStore: RecentKanbanStore;

    refreshUIDebouncer = new Debouncer(REFRESH_UI_DEBOUNCE_MS);

    joplinService: JoplinService;

    linkParser: LinkParser = new LinkParser();

    kanbanMessageQueue: AsyncQueue = new AsyncQueue();

    dialogView: string | null = null;

    constructor(joplinService: JoplinService) {
        this.openBoard = undefined;
        this.boardView = null;
        this.recentKanbanStore = new RecentKanbanStore();
        this.joplinService = joplinService;
        this.kanbanMessageQueue = new AsyncQueue();
    }

    async load() {
        await this.recentKanbanStore.load();

        const selectedNote = await joplin.workspace.selectedNote();
        if (selectedNote) {
            await this.handleNewlyOpenedNote(selectedNote.id);
        }
    }

    async showBoard() {
        if (this.boardView) {
            await joplin.views.panels.show(this.boardView);
        }
    }

    hideBoard() {
        if (this.boardView) {
            joplin.views.panels.hide(this.boardView);
        }
    }

    /**
     * Try loading a config from noteId. If succesful, replace the current board,
     * if not destroy it (because we are assuming the config became invalid).
     */
    async reloadConfig(noteId: string): Promise<boolean> {
        const note = await getConfigNote(noteId);
        const board = noteId === this.openBoard?.configNoteId
            ? this.openBoard
            : new Board(noteId, note.parent_id, note.title);
        const ymlConfig = getYamlConfig(note.body);
        const valid = ymlConfig !== null && (await board.loadConfig(ymlConfig));
        if (valid) {
            this.openBoard = board;
            await this.prependRecentKanban(noteId, note.title);
            return true;
        }
        // Do nothing if it is not valid.
        // User could close the kanban by using the "x" button
        return false;
    }

    refreshUI() {
        this.refreshUIDebouncer.debounce(async () => {
            if (this.boardView) {
                joplin.views.panels.postMessage(this.boardView, {
                    type: "refresh",
                });
            }
        }).catch((e) => {
            if (e instanceof Error && e.name === "AbortedError") {
                // Ignore errors
            } else {
                console.error("Error refreshing UI", e);
            }
        });
    }

    /**
 * Shows a confirmation dialog using Joplin's built-in message box
 */
    async showConfirmDialog(message: string): Promise<boolean> {
        const result = await joplin.views.dialogs.showMessageBox(message);
        return result === 0; // 0 = OK, 1 = Cancel
    }

    /**
 * Constructs and shows the UI configurator.
 * @returns The newly generated YAML, without ```kanban fence.
 */
    async showConfigUI(targetPath: string) {
        if (!this.openBoard || !this.openBoard.parsedConfig) return;

        if (!this.dialogView) {
            this.dialogView = await joplin.views.dialogs.create("kanban-config-ui");
            await joplin.views.dialogs.addScript(this.dialogView, "configui/main.css");
            await joplin.views.dialogs.addScript(this.dialogView, "configui/index.js");
        }

        const config: Config = targetPath === "columnnew"
            ? {
                ...this.openBoard.parsedConfig,
                columns: [...this.openBoard.parsedConfig.columns, { name: "New Column" }],
            }
            : this.openBoard.parsedConfig;

        if (targetPath.startsWith("columns.")) {
            const [, colName] = targetPath.split(".", 2);
            const colIdx = this.openBoard.parsedConfig.columns.findIndex(
                ({ name }) => name === colName,
            );
            targetPath = `columns.${colIdx}`;
        }
        if (targetPath === "columnnew") targetPath = `columns.${config.columns.length - 1}`;

        const data: ConfigUIData = {
            config,
            targetPath,
            ruleEditorTypes: getRuleEditorTypes(targetPath),
            allTags: await getAllTags(),
            allNotebooks: (await getAllNotebooks()).map((n) => n.title),
        };

        const html = `
      <template id="data">
        ${encodeURIComponent(JSON.stringify(data))}
      </template>
      <div id="root"></div>
    `;
        await joplin.views.dialogs.setHtml(this.dialogView, html);
        const result = await joplin.views.dialogs.open(this.dialogView);
        if (result.id === "ok" && result.formData) {
            const newYaml = result.formData.config.yaml;
            return newYaml;
        }
    }

    async updateBoardByAction(msg: Action) {
        if (!this.openBoard) return;
        const allNotesOld = await searchNotes(this.openBoard.rootNotebookName, this.openBoard.baseTags);
        const oldState: BoardState = this.openBoard.getBoardState(allNotesOld);
        const updates = this.openBoard.getBoardUpdate(msg, oldState);
        for (const query of updates) {
            await executeUpdateQuery(query);
            this.openBoard.executeUpdateQuery(query);
        }
    }

    async postInsertNoteToColumn(msg: InsertNoteToColumnAction) {
        if (!this.openBoard) return;
        const { noteId, columnName, index } = msg.payload;
        const noteData = await this.joplinService.getNoteDataById(noteId);
        noteData.order = Date.now();
        this.openBoard.appendNoteCache(noteData);
    }

    /**
 * Handle messages coming from the webview.
 *
 * Almost all changes to the state occur in this method.
 */
    async handleKanbanMessage(msg: Action) {
        if (msg.type === "close") {
            // Allow to close the panel but no kanban is opened
            return this.handleCloseMessage(msg);
        }
        if (!this.openBoard) return this.handleNoOpenedBoard();

        switch (msg.type) {
        // Those actions do not update state, so it can return immediately
        case "requestToShowRecentKanban": {
            if (this.boardView) {
                joplin.views.panels.postMessage(this.boardView, {
                    type: "showRecentKanban",
                    payload: {
                        recentKanbans: this.getRecentKanbans(),
                    },
                });
            }
            return;
        }

        case "requestToRemoveRecentKanbanItem": {
            await this.removeRecentKanban(msg.payload.noteId);
            return;
        }

        case "openNoteInNewWindow": {
            await joplin.commands.execute("openNoteInNewWindow", msg.payload.noteId);
            return;
        }
        case "openNote": {
            await this.joplinService.openNote(msg.payload.noteId);
            return;
        }
        case "openKanbanConfigNote": {
            await this.joplinService.openNote(this.openBoard.configNoteId);
            return;
        }
        case "openKanban": {
            await this.reloadConfig(msg.payload.noteId);
            this.refreshUI();
            return;
        }

        case "columnTitleClicked": {
            const { link } = msg.payload;
            const parsedLink = this.linkParser.parse(link);

            if (parsedLink.type !== LinkType.NoteLink) {
                this.joplinService.toast("Invalid column link", "error");
                break;
            }

            try {
                const valid = await this.reloadConfig(parsedLink.noteId ?? "");
                if (valid) {
                    this.refreshUI();
                } else {
                    this.joplinService.openNote(link);
                }
            } catch (error) {
                this.joplinService.toast(`Error: Could not open note with ID ${link}`, "error");
            }
            break;
        }
        }
        return this.kanbanMessageQueue.enqueue(async () => this.handleQueuedKanbanMessage(msg)).catch(
            () => {},
        );
    }

    async handleQueuedKanbanMessage(msg: Action) {
        if (!this.openBoard) return this.handleNoOpenedBoard();

        let showReloadedToast = false;

        switch (msg.type) {
        case "settings": {
            const { target } = msg.payload;
            const newConf = await this.showConfigUI(target);
            if (newConf) {
                await setConfigNote(this.openBoard.configNoteId, newConf);
                await this.reloadConfig(this.openBoard.configNoteId);
            }
            break;
        }

        case "deleteCol": {
            if (!this.openBoard.parsedConfig) break;

            const confirmed = await this.showConfirmDialog(
                `Are you sure you want to delete the column "${msg.payload.colName}"?`,
            );

            if (!confirmed) break;

            const colIdx = this.openBoard.parsedConfig.columns.findIndex(
                ({ name }) => name === msg.payload.colName,
            );
            const newConf: Config = {
                ...this.openBoard.parsedConfig,
                columns: [
                    ...this.openBoard.parsedConfig.columns.slice(0, colIdx),
                    ...this.openBoard.parsedConfig.columns.slice(colIdx + 1),
                ],
            };
            await setConfigNote(this.openBoard.configNoteId, yaml.dump(newConf));
            await this.reloadConfig(this.openBoard.configNoteId);
            break;
        }

        case "addColumn": {
            const newConf = await this.showConfigUI("columnnew");
            if (newConf) {
                await setConfigNote(this.openBoard.configNoteId, newConf);
                await this.reloadConfig(this.openBoard.configNoteId);
            }
            break;
        }

        case "messageAction": {
            const { messageId, actionName } = msg.payload;
            if (messageId === "reload" && actionName === "reload") {
                await this.reloadConfig(this.openBoard.configNoteId);
            }
            // New message action add here
            break;
        }

        case "newNote": {
            const allNotesOld = await searchNotes(this.openBoard.rootNotebookName, this.openBoard.baseTags);
            const oldState: BoardState = this.openBoard.getBoardState(allNotesOld);
            const newNoteId = await this.joplinService.createUntitledNote();
            msg.payload.noteId = newNoteId;
            const noteMonad = NoteDataMonad.fromNewNote(newNoteId);
            for (const query of this.openBoard.getBoardUpdate(msg, oldState)) {
                await executeUpdateQuery(query);
                noteMonad.applyUpdateQuery(query);
            }
            // The note may be available but tags may not be available yet
            // Let's cache it first.
            const createdNote = noteMonad.data;
            const timestamp = Date.now();
            createdNote.order = timestamp;
            createdNote.createdTime = timestamp;
            this.openBoard.appendNoteCache(createdNote);
            break;
        }

        case "removeNoteFromKanban": {
            const confirmed = await this.showConfirmDialog(
                "Are you sure you want to remove this note from the kanban board?",
            );

            if (!confirmed) break;

            this.openBoard.removeNoteCache([msg.payload.noteId]);

            await this.updateBoardByAction(msg);
            break;
        }

        // New state is sent in any case, so load is a no-op
        case "load":
            break;

        case "poll":
        // No need to send to boardView
            showReloadedToast = msg.payload?.showReloadedToast ?? false;
            break;

            // Propagete action to the active board
        default: {
            await this.updateBoardByAction(msg);
            if (msg.type === "insertNoteToColumn") {
                await this.postInsertNoteToColumn(msg as InsertNoteToColumnAction);
            }
        }
        }
        const searchedNotes = await searchNotes(this.openBoard.rootNotebookName, this.openBoard.baseTags);
        this.openBoard.removeNoteCache(searchedNotes.map((note) => note.id));
        const allNotesNew = this.openBoard.mergeCachedNotes(searchedNotes);
        const newState: BoardState = this.openBoard.getBoardState(allNotesNew);
        const currentYaml = getYamlConfig(
            (await getConfigNote(this.openBoard.configNoteId)).body,
        );
        if (currentYaml !== this.openBoard.configYaml) {
            if (!currentYaml) return this.hideBoard();
            const { error } = parseConfigNote(currentYaml);
            newState.messages.push(
                error || {
                    id: "reload",
                    severity: "warning",
                    title:
            "The configuration has changed, would you like to reload the board?",
                    actions: ["reload"],
                },
            );
        }

        if (msg.type !== "poll") {
            if (
                this.openBoard.isValid
        && this.openBoard.parsedConfig?.display?.markdown == "list"
            ) setConfigNote(this.openBoard.configNoteId, null, getMdList(newState));
            else if (
                this.openBoard.isValid
        && (this.openBoard.parsedConfig?.display?.markdown == "table"
          || this.openBoard.parsedConfig?.display?.markdown == undefined)
            ) setConfigNote(this.openBoard.configNoteId, null, getMdTable(newState));
        }

        if (showReloadedToast) {
            this.joplinService.toast("Reloaded");
        }

        return newState;
    }

    /**
     * Handle note selection change, check if a new board has been opened, or if we left
     * the domain of the current board.
     */
    async handleNewlyOpenedNote(newNoteId: string) {
        if (this.openBoard) {
            if (this.openBoard.configNoteId === newNoteId) return;
            if (await this.openBoard.isNoteIdOnBoard(newNoteId)) return;

            const originalOpenBoard = this.openBoard;
            await this.reloadConfig(newNoteId);
            if (this.openBoard && this.openBoard.isValid && originalOpenBoard !== this.openBoard) {
                this.refreshUI();
            }
            return;
        }

        if (!this.openBoard || (this.openBoard as Board).configNoteId !== newNoteId) {
            await this.reloadConfig(newNoteId);
            if (this.openBoard) {
                await this.showBoard();

                // #2 show only "Loading..." instead of Kanban board
                this.refreshUI();
            }
        }
    }

    handleCloseMessage(msg: Action) {
        if (msg.type === "close") {
            this.openBoard = undefined;
            return this.hideBoard();
        }
    }

    handleNoOpenedBoard(): BoardState {
        return {
            name: "No Kanban Selected",
            hiddenTags: [],
            messages: [
                {
                    id: "no-board-selected",
                    title: "Please select a valid kanban note",
                    severity: "error",
                    actions: [],
                    details: "or you may close this panel",
                },
            ],
            columns: [],
        };
    }

    async prependRecentKanban(noteId: string, title: string) {
        this.recentKanbanStore.prependKanban(noteId, title);
        await this.recentKanbanStore.save();
    }

    getRecentKanbans() {
        return this.recentKanbanStore.getKanbans();
    }

    async removeRecentKanban(noteId: string) {
        this.recentKanbanStore.removeKanban(noteId);
        await this.recentKanbanStore.save();
    }
}
