"use client";

import {
  createEcosystemWhiteboard,
  createEmptyProcess,
  type ProcessBoard,
  type ProcessCard,
  type ProcessCardTone,
  type ProcessColumn,
} from "@/lib/process/types";

const STORAGE_KEY = "msgate.process.boards.v2";

function clone<T>(v: T): T {
  return structuredClone(v);
}

function readAll(): ProcessBoard[] {
  if (typeof window === "undefined") return [createEcosystemWhiteboard()];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seed = [createEcosystemWhiteboard()];
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
      return seed;
    }
    const parsed = JSON.parse(raw) as ProcessBoard[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      const seed = [createEcosystemWhiteboard()];
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
      return seed;
    }
    // Ensure master whiteboard exists
    if (!parsed.some((b) => b.id === "process-ecosystem-master")) {
      parsed.unshift(createEcosystemWhiteboard());
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    }
    return parsed;
  } catch {
    return [createEcosystemWhiteboard()];
  }
}

function writeAll(boards: ProcessBoard[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(boards));
  } catch {
    /* ignore */
  }
}

export function resetMasterWhiteboard(): ProcessBoard {
  const master = createEcosystemWhiteboard();
  const all = readAll().filter((b) => b.id !== "process-ecosystem-master");
  all.unshift(master);
  writeAll(all);
  return clone(master);
}

export function getProcessBoard(id: string): ProcessBoard | null {
  return readAll().find((b) => b.id === id) ?? null;
}

export function saveProcessBoard(board: ProcessBoard): ProcessBoard {
  const all = readAll();
  const next = { ...board, updated_at: new Date().toISOString() };
  const idx = all.findIndex((b) => b.id === next.id);
  if (idx >= 0) all[idx] = next;
  else all.push(next);
  writeAll(all);
  return clone(next);
}

export function createProcessBoard(name: string): ProcessBoard {
  const board = createEmptyProcess(name);
  const all = readAll();
  all.push(board);
  writeAll(all);
  return clone(board);
}

export function deleteProcessBoard(id: string): void {
  writeAll(readAll().filter((b) => b.id !== id));
}

export function renameProcessBoard(id: string, name: string): ProcessBoard | null {
  const board = getProcessBoard(id);
  if (!board) return null;
  board.name = name.trim() || board.name;
  return saveProcessBoard(board);
}

export function updateColumn(
  boardId: string,
  columnId: string,
  patch: Partial<Pick<ProcessColumn, "title" | "subtitle">>
): ProcessBoard | null {
  const board = getProcessBoard(boardId);
  if (!board) return null;
  board.columns = board.columns.map((c) =>
    c.id === columnId ? { ...c, ...patch } : c
  );
  return saveProcessBoard(board);
}

export function updateCard(
  boardId: string,
  columnId: string,
  cardId: string,
  patch: Partial<Pick<ProcessCard, "title" | "body" | "tone">>
): ProcessBoard | null {
  const board = getProcessBoard(boardId);
  if (!board) return null;
  board.columns = board.columns.map((col) => {
    if (col.id !== columnId) return col;
    return {
      ...col,
      cards: col.cards.map((card) =>
        card.id === cardId ? { ...card, ...patch } : card
      ),
    };
  });
  return saveProcessBoard(board);
}

export function addCard(
  boardId: string,
  columnId: string,
  tone: ProcessCardTone = "yellow"
): ProcessBoard | null {
  const board = getProcessBoard(boardId);
  if (!board) return null;
  board.columns = board.columns.map((col) => {
    if (col.id !== columnId) return col;
    return {
      ...col,
      cards: [
        ...col.cards,
        {
          id: `card-${Date.now()}`,
          title: "Nouvelle carte",
          body: "",
          tone,
        },
      ],
    };
  });
  return saveProcessBoard(board);
}

export function deleteCard(
  boardId: string,
  columnId: string,
  cardId: string
): ProcessBoard | null {
  const board = getProcessBoard(boardId);
  if (!board) return null;
  board.columns = board.columns.map((col) => {
    if (col.id !== columnId) return col;
    return { ...col, cards: col.cards.filter((c) => c.id !== cardId) };
  });
  return saveProcessBoard(board);
}

export function addColumn(boardId: string, title = "Nouvelle colonne"): ProcessBoard | null {
  const board = getProcessBoard(boardId);
  if (!board) return null;
  board.columns.push({
    id: `col-${Date.now()}`,
    title,
    cards: [],
  });
  return saveProcessBoard(board);
}

export function deleteColumn(boardId: string, columnId: string): ProcessBoard | null {
  const board = getProcessBoard(boardId);
  if (!board) return null;
  board.columns = board.columns.filter((c) => c.id !== columnId);
  return saveProcessBoard(board);
}

export function moveCard(
  boardId: string,
  fromColId: string,
  toColId: string,
  cardId: string,
  toIndex: number
): ProcessBoard | null {
  const board = getProcessBoard(boardId);
  if (!board) return null;
  let moved: ProcessCard | undefined;
  board.columns = board.columns.map((col) => {
    if (col.id !== fromColId) return col;
    const card = col.cards.find((c) => c.id === cardId);
    if (!card) return col;
    moved = card;
    return { ...col, cards: col.cards.filter((c) => c.id !== cardId) };
  });
  if (!moved) return board;
  board.columns = board.columns.map((col) => {
    if (col.id !== toColId) return col;
    const cards = [...col.cards];
    cards.splice(Math.max(0, Math.min(toIndex, cards.length)), 0, moved!);
    return { ...col, cards };
  });
  return saveProcessBoard(board);
}
