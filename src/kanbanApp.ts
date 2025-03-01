import Board from "./board";
import { BoardState } from "./types";

export class KanbanApp {

  board: Board | null = null;
  boardView: string | null = null;

  constructor() {
    this.board = null;
    this.boardView = null;
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

}

