import React from "react";
import styled from "styled-components";
import { useMainContext } from "./MainContext";
import { IoMdClose } from "react-icons/io";
import { useDebouncer } from "../hooks/debouncer";

interface RecentKanbansPanelProps {
  kanbans: Array<{ noteId: string; title: string }>;
  onClose: () => void;
}

const Container = styled.div<{ isOpened: boolean }>((
  {
    isOpened,
  }: {
    isOpened: boolean;
  }
) => ({
  position: "fixed",
  top: 0,
  right: 0,
  bottom: 0,
  width: "240px",
  background: "var(--joplin-background-color)",
  boxShadow: "-2px 0 8px rgba(143, 90, 90, 0.15)",
  display: "flex",
  flexDirection: "column",
  animation: "slideIn 0.3s ease-out",
  borderLeft: "1px solid var(--joplin-divider-color)",
  transform: isOpened ? "translateX(0)" : "translateX(100%)",

  "&.opened": {
    animation: "slideIn 0.3s ease-out",

    "@keyframes slideIn": {
      from: {
        transform: "translateX(100%)"
      },
      to: {
        transform: "translateX(0)"
      }
    }
  },

  "&.closing": {
    animation: "slideOut 0.3s ease-out",
    
    "@keyframes slideOut": {
      from: {
        transform: "translateX(0)"
      },
      to: {
        transform: "translateX(100%)"
      }
    }
  }
}));

const Header = styled.div({
  height: "40px",
  padding: "0 16px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  borderBottom: "1px solid var(--joplin-border-color3)",
});

const Title = styled.h2({
  margin: 0,
  fontSize: "16px",
  fontWeight: 600
});

const CloseButton = styled.button({
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: "8px",
  fontSize: "16px",
  "&:hover": {
    backgroundColor: "var(--joplin-background-color-hover3)",
  },
  "& > svg": {
    width: "1.5em",
    height: "1.5em",
    color: "var(--joplin-color3)",
  },
});

const KanbanList = styled.div({
  flex: 1,
  overflowY: "auto",
  padding: "8px 0"
});

const KanbanItem = styled.button({
  width: "100%",
  padding: "8px 16px",
  textAlign: "left",
  background: "none",
  border: "none",
  cursor: "pointer",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  color: "var(--joplin-color3)",
  
  "&:hover": {
    backgroundColor: "var(--joplin-background-color-hover3)",
  },
  
  "&:active": {
    backgroundColor: "var(--joplin-background-color-active3)",
  }
});

export function useRecentKanbansPanelHandle({
  onClose,
  kanbans
}: RecentKanbansPanelProps) {
  const [isOpened, setIsOpened] = React.useState(false);
  const debouncer = useDebouncer(300);

  const open = React.useCallback(() => {
    setIsOpened(true);
  }, []);

  const close = React.useCallback(() => {
    setIsOpened(false);
    onClose();
  }, [onClose]);

  const props = React.useMemo(() => ({
    isOpened,
    kanbans,
    open,
    close,
  }), [isOpened, kanbans, open, close]);

  return props;
}

export function RecentKanbansPanel(props: ReturnType<typeof useRecentKanbansPanelHandle>) {
  const {
    kanbans,
    close,
    isOpened,
  } = props;

  const {send} = useMainContext();

  const handleKanbanClick = React.useCallback((noteId: string) => {
    send({ type: "openKanban", payload: { noteId } });
  }, [send]);

  const handleContainerClick = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
  }, []);

  return (
      <Container 
        onClick={handleContainerClick} 
        className={isOpened ? "opened" : "closing"}
        isOpened={isOpened}
      >
          <Header>
          <Title>Recent</Title>
          <CloseButton onClick={close}>
              <IoMdClose size="20px"/>
          </CloseButton>
          </Header>
          <KanbanList>
          {kanbans.map((kanban) => (
              <KanbanItem
              key={kanban.noteId}
              onClick={() => handleKanbanClick(kanban.noteId)}
              >
              {kanban.title}
              </KanbanItem>
          ))}
          </KanbanList>
      </Container>
  );
};
