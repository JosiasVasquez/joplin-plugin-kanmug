import joplin from "api";
import * as yaml from "js-yaml";

import Board from "./board";
import { getYamlConfig, parseConfigNote } from "./parser";
import {
  getConfigNote,
  setConfigNote,
  executeUpdateQuery,
  getAllTags,
  getAllNotebooks,
  searchNotes,
} from "./noteData";
import { getRuleEditorTypes } from "./rules";
import { getMdList, getMdTable } from "./markdown";

import type { Action, InsertNoteToColumnAction } from "./actions";
import type { ConfigUIData } from "./configui";
import { type Config, type BoardState, NoteData, NoteDataMonad } from "./types";
import { JoplinService } from "./services/joplinService";
import { AsyncQueue } from "./utils/asyncQueue";
import { SettingItemType } from "api/types";
import { RECENT_KANBANS_STORAGE_KEY, RecentKanbanStore } from "./recentKanbanStore";
import { LinkParser, LinkType } from "./utils/linkParser";
import { KanbanApp } from "./kanbanApp";
const joplinService = new JoplinService();
joplinService.start();

const kanbanApp = new KanbanApp(joplinService);

// UI VIEWS
let dialogView: string | undefined;

/**
 * Constructs and shows the UI configurator.
 * @returns The newly generated YAML, without ```kanban fence.
 */
async function showConfigUI(targetPath: string) {
  if (!kanbanApp.openBoard || !kanbanApp.openBoard.parsedConfig) return;

  if (!dialogView) {
    dialogView = await joplin.views.dialogs.create("kanban-config-ui");
    await joplin.views.dialogs.addScript(dialogView, "configui/main.css");
    await joplin.views.dialogs.addScript(dialogView, "configui/index.js");
  }

  const config: Config =
    targetPath === "columnnew"
      ? {
          ...kanbanApp.openBoard.parsedConfig,
          columns: [...kanbanApp.openBoard.parsedConfig.columns, { name: "New Column" }],
        }
      : kanbanApp.openBoard.parsedConfig;

  if (targetPath.startsWith("columns.")) {
    const [, colName] = targetPath.split(".", 2);
    const colIdx = kanbanApp.openBoard.parsedConfig.columns.findIndex(
      ({ name }) => name === colName
    );
    targetPath = `columns.${colIdx}`;
  }
  if (targetPath === "columnnew")
    targetPath = `columns.${config.columns.length - 1}`;

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
  await joplin.views.dialogs.setHtml(dialogView, html);
  const result = await joplin.views.dialogs.open(dialogView);
  if (result.id === "ok" && result.formData) {
    const newYaml = result.formData.config.yaml;
    return newYaml;
  }
}

let boardView: string | undefined;
/**
 * Constructs and shows the main kanban panel.
 */
async function showBoard() {
  if (!boardView) {
    boardView = await joplin.views.panels.create("kanban");
    kanbanApp.boardView = boardView;
    // Template tags seem to be the easiest way to pass static data to a view
    // If a better way is found, this should be changed
    const html = `
      <template id="date-fmt">${await joplin.settings.globalValue(
        "dateFormat"
      )}</template>
      <div id="root"></div>
      <div id="menu-root"></div>
    `;
    await joplin.views.panels.setHtml(boardView, html);
    await joplin.views.panels.addScript(boardView, "gui/main.css");
    await joplin.views.panels.addScript(boardView, "gui/index.js");
    joplin.views.panels.onMessage(boardView, handleKanbanMessage);
  } else if (!(await joplin.views.panels.visible(boardView))) {
    await joplin.views.panels.show(boardView);
  }
}

/**
 * Hides the active kanban panel.
 */
function hideBoard() {
  if (boardView) joplin.views.panels.hide(boardView);
}

// CONFIG HANDLING


// EVENT HANDLERS

async function updateBoardByAction(msg: Action) {
  if (!kanbanApp.openBoard) return;
  const allNotesOld = await searchNotes(kanbanApp.openBoard.rootNotebookName, kanbanApp.openBoard.baseTags);
  const oldState: BoardState = kanbanApp.openBoard.getBoardState(allNotesOld);
  const updates = kanbanApp.openBoard.getBoardUpdate(msg, oldState);
  for (const query of updates) {
    await executeUpdateQuery(query);
    kanbanApp.openBoard.executeUpdateQuery(query);
  }
}

async function postInsertNoteToColumn(msg: InsertNoteToColumnAction) {
  if (!kanbanApp.openBoard) return;
  const { noteId, columnName, index } = msg.payload;
  let noteData = await joplinService.getNoteDataById(noteId);
  noteData.order = Date.now();
  kanbanApp.openBoard.appendNoteCache(noteData);
}

const linkParser = new LinkParser();
const kanbanMessageQueue = new AsyncQueue();
/**
 * Handle messages coming from the webview.
 *
 * Almost all changes to the state occur in this method.
 */
async function handleKanbanMessage(msg: Action) {
  if (msg.type === "close") {
    // Allow to close the panel but no kanban is opened
    return kanbanApp.handleCloseMessage(msg);
  }
  if (!kanbanApp.openBoard) return kanbanApp.handleNoOpenedBoard();

  switch (msg.type) {
    // Those actions do not update state, so it can return immediately
    case "requestToShowRecentKanban": {
      if (boardView) {
        joplin.views.panels.postMessage(boardView, {
          type: "showRecentKanban",
          payload: {
            recentKanbans: kanbanApp.getRecentKanbans(),
          },
        });
      }
      return;
    }

    case "requestToRemoveRecentKanbanItem": {
      await kanbanApp.removeRecentKanban(msg.payload.noteId);
      return;
    }

    case "openNoteInNewWindow": {
      await joplin.commands.execute("openNoteInNewWindow", msg.payload.noteId);
      return;
    }
    case "openNote": {
      await joplinService.openNote(msg.payload.noteId);
      return;
    }
    case "openKanbanConfigNote": {
      await joplinService.openNote(kanbanApp.openBoard.configNoteId);
      return;
    }
    case "openKanban": {
      await kanbanApp.reloadConfig(msg.payload.noteId);
      kanbanApp.refreshUI();
      return;
    }

    case "columnTitleClicked": {
      const { link } = msg.payload;
      const parsedLink = linkParser.parse(link);

      if (parsedLink.type !== LinkType.NoteLink) {
        joplinService.toast("Invalid column link", "error");
        break;
      }

      try {
        const valid = await kanbanApp.reloadConfig(parsedLink.noteId ?? "");
        if (valid) {
          kanbanApp.refreshUI();
        } else {
          joplinService.openNote(link);
        }
      } catch (error) {
        joplinService.toast(`Error: Could not open note with ID ${link}`, "error");
      }
      break;
    }
  }
  return kanbanMessageQueue.enqueue(handleQueuedKanbanMessage, msg).catch(
    () => {});
}

/**
 * Shows a confirmation dialog using Joplin's built-in message box
 */
async function showConfirmDialog(message: string): Promise<boolean> {
  const result = await joplin.views.dialogs.showMessageBox(message);
  return result === 0; // 0 = OK, 1 = Cancel
}

async function handleQueuedKanbanMessage(msg: Action) {
  if (!kanbanApp.openBoard) return kanbanApp.handleNoOpenedBoard();

  let showReloadedToast = false;

  switch (msg.type) {
    case "settings": {
      const { target } = msg.payload;
      const newConf = await showConfigUI(target);
      if (newConf) {
        await setConfigNote(kanbanApp.openBoard.configNoteId, newConf);
        await kanbanApp.reloadConfig(kanbanApp.openBoard.configNoteId);
      }
      break;
    }

    case "deleteCol": {
      if (!kanbanApp.openBoard.parsedConfig) break;
      
      const confirmed = await showConfirmDialog(
        `Are you sure you want to delete the column "${msg.payload.colName}"?`
      );
      
      if (!confirmed) break;

      const colIdx = kanbanApp.openBoard.parsedConfig.columns.findIndex(
        ({ name }) => name === msg.payload.colName
      );
      const newConf: Config = {
        ...kanbanApp.openBoard.parsedConfig,
        columns: [
          ...kanbanApp.openBoard.parsedConfig.columns.slice(0, colIdx),
          ...kanbanApp.openBoard.parsedConfig.columns.slice(colIdx + 1),
        ],
      };
      await setConfigNote(kanbanApp.openBoard.configNoteId, yaml.dump(newConf));
      await kanbanApp.reloadConfig(kanbanApp.openBoard.configNoteId);
      break;
    }

    case "addColumn": {
      const newConf = await showConfigUI("columnnew");
      if (newConf) {
        await setConfigNote(kanbanApp.openBoard.configNoteId, newConf);
        await kanbanApp.reloadConfig(kanbanApp.openBoard.configNoteId);
      }
      break;
    }

    case "messageAction": {
      const { messageId, actionName } = msg.payload;
      if (messageId === "reload" && actionName === "reload") {
        await kanbanApp.reloadConfig(kanbanApp.openBoard.configNoteId);
      }
      // New message action add here
      break;
    }

    case "newNote": {
      const allNotesOld = await searchNotes(kanbanApp.openBoard.rootNotebookName, kanbanApp.openBoard.baseTags);
      const oldState: BoardState = kanbanApp.openBoard.getBoardState(allNotesOld);
      const newNoteId = await joplinService.createUntitledNote();
      msg.payload.noteId = newNoteId;
      const noteMonad = NoteDataMonad.fromNewNote(newNoteId);
      for (const query of kanbanApp.openBoard.getBoardUpdate(msg, oldState)) {
        await executeUpdateQuery(query);
        noteMonad.applyUpdateQuery(query);
      }
      // The note may be available but tags may not be available yet
      // Let's cache it first.
      const createdNote = noteMonad.data;
      const timestamp = Date.now();
      createdNote.order = timestamp;
      createdNote.createdTime = timestamp;
      kanbanApp.openBoard.appendNoteCache(createdNote);
      break;
    }

    case "removeNoteFromKanban": {
      const confirmed = await showConfirmDialog(
        "Are you sure you want to remove this note from the kanban board?"
      );
      
      if (!confirmed) break;
      
      kanbanApp.openBoard.removeNoteCache([msg.payload.noteId]);

      await updateBoardByAction(msg);
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
      await updateBoardByAction(msg);
      if (msg.type === "insertNoteToColumn") {
        await postInsertNoteToColumn(msg as InsertNoteToColumnAction);
      }
    }
  }
  const searchedNotes = await searchNotes(kanbanApp.openBoard.rootNotebookName, kanbanApp.openBoard.baseTags);
  kanbanApp.openBoard.removeNoteCache(searchedNotes.map(note => note.id));
  const allNotesNew = kanbanApp.openBoard.mergeCachedNotes(searchedNotes);
  const newState: BoardState = kanbanApp.openBoard.getBoardState(allNotesNew);
  const currentYaml = getYamlConfig(
    (await getConfigNote(kanbanApp.openBoard.configNoteId)).body
  );
  if (currentYaml !== kanbanApp.openBoard.configYaml) {
    if (!currentYaml) return hideBoard();
    const { error } = parseConfigNote(currentYaml);
    newState.messages.push(
      error || {
        id: "reload",
        severity: "warning",
        title:
          "The configuration has changed, would you like to reload the board?",
        actions: ["reload"],
      }
    );
  }

  if (msg.type !== "poll") {
    if (
      kanbanApp.openBoard.isValid &&
      kanbanApp.openBoard.parsedConfig?.display?.markdown == "list"
    )
      setConfigNote(kanbanApp.openBoard.configNoteId, null, getMdList(newState));
    else if (
      kanbanApp.openBoard.isValid &&
      (kanbanApp.openBoard.parsedConfig?.display?.markdown == "table" ||
        kanbanApp.openBoard.parsedConfig?.display?.markdown == undefined)
    )
      setConfigNote(kanbanApp.openBoard.configNoteId, null, getMdTable(newState));
  }

  if (showReloadedToast) {
    joplinService.toast("Reloaded");
  }

  return newState;
}

/**
 * Handle note selection change, check if a new board has been opened, or if we left
 * the domain of the current board.
 */
async function handleNewlyOpenedNote(newNoteId: string) {

  if (kanbanApp.openBoard) {
    if (kanbanApp.openBoard.configNoteId === newNoteId) return;
    if (await kanbanApp.openBoard.isNoteIdOnBoard(newNoteId)) return;
    else {
      const originalOpenBoard = kanbanApp.openBoard;
      await kanbanApp.reloadConfig(newNoteId);
      if (kanbanApp.openBoard && kanbanApp.openBoard.isValid && originalOpenBoard!==kanbanApp.openBoard) {
        kanbanApp.refreshUI();
      }
      return;
    }
  }

  if (!kanbanApp.openBoard || (kanbanApp.openBoard as Board).configNoteId !== newNoteId) {
    await kanbanApp.reloadConfig(newNoteId);
    if (kanbanApp.openBoard) {
      showBoard();

      // #2 show only "Loading..." instead of Kanban board
      kanbanApp.refreshUI();
    }
  }
}

joplin.plugins.register({
  onStart: async function () {
    // Have to call this on start otherwise layout from prevoius session is lost
    showBoard().then(hideBoard);

    joplin.workspace.onNoteSelectionChange(
      async ({ value }: { value: [string?] }) => {
        const newNoteId = value?.[0] as string;
        if (newNoteId) handleNewlyOpenedNote(newNoteId);
      }
    );

    joplin.workspace.onNoteChange(async ({ id }) => {
      if (!kanbanApp.openBoard) return;
      if (kanbanApp.openBoard.configNoteId === id) {
        if (!kanbanApp.openBoard.isValid) await kanbanApp.reloadConfig(id);
        kanbanApp.refreshUI();
      } else if (await kanbanApp.openBoard.isNoteIdOnBoard(id)) {
        kanbanApp.refreshUI();
      }
    });

    const settings = {
      [RECENT_KANBANS_STORAGE_KEY]: {
        value: [],
        type: SettingItemType.Object,
        public: false,
        label: "Recent Kanbans",
        section: "kanmug",
      },
    };
    
    await joplin.settings.registerSettings(settings);
    await kanbanApp.load();
  },
});
