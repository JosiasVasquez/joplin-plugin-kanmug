import React, { useRef } from "react";

import ClickableCard from "./ClickableCard";
import { useDraggableCard, useDroppableCard } from "./DragDrop";
import type { NoteData } from "../types";
import ContextMenu from "./ContextMenu";

interface DraggableCardProps {
  note: NoteData;
  colName: string;
  index: number;
}

export default function ({ note, colName, index }: DraggableCardProps) {
    const ref = useRef<HTMLDivElement>(null);
    const cardRef = useRef<HTMLDivElement>(null);
    const { handlerId, withPlaceholder } = useDroppableCard({
        ref,
        contentRef: cardRef,
        colName,
        noteId: note.id,
        index,
    });

    const { display } = useDraggableCard({
        colName, index, note, ref,
    });

    const onDragStart = React.useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.dataTransfer.setData("text/x-jop-note-ids", JSON.stringify([note.id]));
        e.dataTransfer.setData("text/x-kanmug-note-ids", JSON.stringify([note.id]));
    }, [note.id]);

    return (
        <div
            ref={ref}
            style={{ display, overflow: "auto" }}
            data-handler-id={handlerId}
            onDragStart={onDragStart}
        >
            {withPlaceholder(
                <ClickableCard ref={cardRef} note={note} />,
            )}
        </div>
    );
}
