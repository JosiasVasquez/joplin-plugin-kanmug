// src/gui/useAnnouncer.ts
import { useContext, createContext } from "react";

export const AnnouncerContext = createContext({
    announce: (_message: string) => {
        // La función por defecto no hace nada
    },
});

export const useAnnouncer = () => useContext(AnnouncerContext);