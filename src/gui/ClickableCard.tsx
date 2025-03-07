import React from "react";

import Card from "./Card";
import type { NoteData } from "../types";
import { useMainContext } from "./MainContext";
import ContextMenu from "./ContextMenu";

const MenuItem = {
    RemoveFromKanban: "Remove from Kanban",
    OpenNoteInNewWindow: "Open in New Window",
};

export default React.forwardRef<HTMLDivElement, { note: NoteData }>(
    ({ note }, ref) => {
        const { send, dispatch } = useMainContext();
        const handleClick = () => {
            send({
                type: "openNote",
                payload: { noteId: note.id },
            });
        };

        const handleMenu = React.useCallback((option: string) => {
            if (option === MenuItem.RemoveFromKanban) {
                dispatch({
                    type: "removeNoteFromKanban",
                    payload: { noteId: note.id },
                });
            } else if (option === MenuItem.OpenNoteInNewWindow) {
                send({
                    type: "openNoteInNewWindow",
                    payload: { noteId: note.id },
                });
            }
        }, []);

        return (
            <div ref={ref} onClick={handleClick}>
                <ContextMenu options={[MenuItem.OpenNoteInNewWindow, MenuItem.RemoveFromKanban]} onSelect={handleMenu}>
                    <Card note={note}/>
                </ContextMenu>
            </div>
        );
    },
);
