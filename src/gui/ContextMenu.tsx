import React, {
    useState, useEffect, useCallback, useRef,
} from "react";
import styled from "styled-components";
import { createPortal } from "react-dom";
import { Backdrop } from "./Backdrop";

const MENU_WIDTH = 150;

export default function ({
    options,
    onSelect,
    children,
}: {
  options: string[];
  onSelect: (selected: string) => void;
  children: React.ReactElement;
}) {
    const [state, setState] = useState<{
    posX: number | null;
    posY: number | null;
    triggerRef?: React.RefObject<HTMLElement>;
  }>({ posX: null, posY: null });

    const { posX, posY, triggerRef } = state;
    const isOpen = posX !== null && posY !== null;
    const menuItemsRef = useRef<(HTMLButtonElement | null)[]>([]);

    useEffect(() => {
        if (isOpen) {
            menuItemsRef.current[0]?.focus();
        } else {
            triggerRef?.current?.focus();
        }
    }, [isOpen, triggerRef]);

    const handleContextMenu = (ev: React.MouseEvent) => {
        ev.preventDefault();
        setState({
            posX: ev.clientX,
            posY: ev.clientY,
            triggerRef: { current: ev.currentTarget as HTMLElement },
        });
    };

    const handleTriggerKeyDown = (ev: React.KeyboardEvent) => {
        if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            const rect = ev.currentTarget.getBoundingClientRect();
            setState({
                posX: rect.left,
                posY: rect.bottom,
                triggerRef: { current: ev.currentTarget as HTMLElement },
            });
        }
    };

    const closeMenu = useCallback(() => {
        setState((s) => ({ ...s, posX: null, posY: null }));
    }, []);

    const handleMenuKeyDown = (ev: React.KeyboardEvent) => {
        if (!isOpen) return;

        const { key } = ev;
        if (key === "Escape") {
            closeMenu();
            return;
        }

        if (key === "ArrowDown" || key === "ArrowUp") {
            ev.preventDefault();
            const currentIdx = menuItemsRef.current.indexOf(
                document.activeElement as HTMLButtonElement,
            );
            const dir = key === "ArrowDown" ? 1 : -1;
            const nextIdx = (currentIdx + dir + options.length) % options.length;
            menuItemsRef.current[nextIdx]?.focus();
        }
    };

    return (
        <>
            <div onContextMenu={handleContextMenu} onKeyDown={handleTriggerKeyDown}>{children}</div>
            {isOpen
        && createPortal(
            <Backdrop isOpened={isOpen} onClose={closeMenu}>
                <FloatingMenu
                    role="menu"
                    onKeyDown={handleMenuKeyDown}
                    posX={posX}
                    posY={posY}
                >
                    {options.map((opt, idx) => (
                        <MenuItem
                            key={idx}
                            role="menuitem"
                            ref={(el) => {
                                menuItemsRef.current[idx] = el;
                            }}
                            onClick={() => {
                                onSelect(opt);
                                closeMenu();
                            }}
                        >
                            {opt}
                        </MenuItem>
                    ))}
                </FloatingMenu>
            </Backdrop>,
          document.getElementById("joplin-plugin-content-root")!,
        )}
        </>
    );
}

const FloatingMenu = styled.div<{ posX: number | null; posY: number | null }>(
    ({ posX, posY }) => ({
        position: "fixed",
        top: posY || "0",
        left: posX || "0",
        width: `${MENU_WIDTH}px`,
        backgroundColor: "var(--joplin-background-color)",
        border: "1px solid var(--joplin-divider-color)",
        padding: "2px 0",
        zIndex: 10000,
    }),
);

const MenuItem = styled.button({
    display: "block",
    width: "100%",
    border: "none",
    backgroundColor: "transparent",
    textAlign: "left",
    padding: "7px 14px",
    userSelect: "none",
    color: "var(--joplin-color)",
    "&:hover, &:focus": {
        backgroundColor: "var(--joplin-background-color-hover3)",
        outline: "none",
    },
});
