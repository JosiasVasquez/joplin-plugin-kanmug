export enum LinkType {
  HyperLink = "hyperlink",
  NoteLink = "notelink", 
  InvalidLink = "invalid"
}

type ParsedLink = {
  type: LinkType;
  noteId?: string;
  url?: string;
}

const NOTE_ID_PATTERN = /^[a-f0-9]{32}$/;
const VALID_SCHEMES = ["file:", "http:", "https:", "joplin:"];

export class LinkParser {
  parse(link: string): ParsedLink {
    if (!link || typeof link !== "string") {
      return {
        type: LinkType.InvalidLink,
      };
    }

    if (NOTE_ID_PATTERN.test(link)) {
      return {
        type: LinkType.NoteLink,
        noteId: link,
      };
    }

    try {
      const url = new URL(link);
      
      if (url.protocol === "joplin:") {
        const noteId = url.searchParams.get("id");
        if (noteId && NOTE_ID_PATTERN.test(noteId) && url.pathname.endsWith("/openNote")) {
          return {
            type: LinkType.NoteLink,
            noteId: noteId,
            url: link
          };
        } else {
          return {
            type: LinkType.InvalidLink,
          };
        }
      }

      if (VALID_SCHEMES.includes(url.protocol)) {
        return {
          type: LinkType.HyperLink,
          url: link
        };
      }
    } catch {
    }

    return {
      type: LinkType.InvalidLink,
    };
  }
}
