import joplin from "api";
import { Action } from "./actions";
import Board from "./board";
import { BoardState } from "./types";
import { RecentKanbanStore } from "./recentKanbanStore";
import { Debouncer } from "./utils/debouncer";
import { JoplinService } from "./services/joplinService";
import { getConfigNote } from "./noteData";
import { getYamlConfig } from "./parser";

const REFRESH_UI_DEBOUNCE_MS = 100;

export class KanbanApp {

  openBoard: Board | undefined = undefined;
  boardView: string | null = null;
  recentKanbanStore: RecentKanbanStore;
  refreshUIDebouncer = new Debouncer(REFRESH_UI_DEBOUNCE_MS);
  joplinService: JoplinService;

  constructor(joplinService: JoplinService) {
    this.openBoard = undefined;
    this.boardView = null;
    this.recentKanbanStore = new RecentKanbanStore();
    this.joplinService = joplinService;
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
    const board =
      noteId === this.openBoard?.configNoteId
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
            type: "refresh"
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
     * Handle note selection change, check if a new board has been opened, or if we left
     * the domain of the current board.
     */
    async  handleNewlyOpenedNote(newNoteId: string) {

    if (this.openBoard) {
      if (this.openBoard.configNoteId === newNoteId) return;
      if (await this.openBoard.isNoteIdOnBoard(newNoteId)) return;
      else {
        const originalOpenBoard = this.openBoard;
        await this.reloadConfig(newNoteId);
        if (this.openBoard && this.openBoard.isValid && originalOpenBoard!==this.openBoard) {
          this.refreshUI();
        }
        return;
      }
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

  handleKanbanMessage(msg: Action) {
    if (msg.type === "close") {
      this.openBoard = undefined;
      this.boardView = null;
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
            }
        ],
        columns: [],
    }
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

