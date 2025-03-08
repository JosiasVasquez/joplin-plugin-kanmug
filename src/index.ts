import joplin from "api";
import * as yaml from "js-yaml";

import { SettingItemType } from "api/types";
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
import {
    type Config, type BoardState, NoteData, NoteDataMonad,
} from "./types";
import { JoplinService } from "./services/joplinService";
import { AsyncQueue } from "./utils/asyncQueue";
import { RECENT_KANBANS_STORAGE_KEY, RecentKanbanStore } from "./recentKanbanStore";
import { KanbanApp } from "./kanbanApp";

const joplinService = new JoplinService();
joplinService.start();

const kanbanApp = new KanbanApp(joplinService);

let boardView: string | undefined;

async function createBoard() {
    if (!boardView) {
        boardView = await joplin.views.panels.create("kanban");
        kanbanApp.boardView = boardView;
        const html = `
      <template id="date-fmt">${await joplin.settings.globalValue(
        "dateFormat",
    )}</template>
      <div id="root"></div>
      <div id="menu-root"></div>
    `;
        await joplin.views.panels.setHtml(boardView, html);
        await joplin.views.panels.addScript(boardView, "gui/main.css");
        await joplin.views.panels.addScript(boardView, "gui/index.js");
        joplin.views.panels.onMessage(boardView, (msg: Action) => kanbanApp.handleKanbanMessage(msg));
    }
}

joplin.plugins.register({
    async onStart() {
        createBoard();

        joplin.workspace.onNoteSelectionChange(
            async ({ value }: { value: [string?] }) => {
                const newNoteId = value?.[0] as string;
                if (newNoteId) kanbanApp.handleNewlyOpenedNote(newNoteId);
            },
        );

        joplin.workspace.onNoteChange(async ({ id }) => {
            if (!kanbanApp.openBoard) return;
            if (kanbanApp.openBoard.configNoteId === id) {
                if (!kanbanApp.openBoard.isValid) await kanbanApp.loadConfig(id);
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
