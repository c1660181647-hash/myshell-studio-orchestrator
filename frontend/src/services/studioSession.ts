export const LAST_STUDIO_PROJECT_KEY = 'dreamy-studio:last-project-id';
export const STUDIO_DISPATCH_SESSION_KEY = 'dreamy-studio:dispatch-session';
export const STUDIO_SESSION_CHANGED_EVENT = 'dreamy-studio:session-changed';

export interface StudioDispatchSession {
  projectId: string;
  pageId?: string;
  pageName?: string;
  navigationPath?: string;
  studioReturnPath?: string;
  updatedAt: string;
}

function notifyStudioSessionChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(STUDIO_SESSION_CHANGED_EVENT));
}

export function readLastStudioProjectId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(LAST_STUDIO_PROJECT_KEY);
  } catch {
    return null;
  }
}

export function saveLastStudioProjectId(projectId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LAST_STUDIO_PROJECT_KEY, projectId);
    notifyStudioSessionChanged();
  } catch {
    // Storage can be unavailable in embedded browsers; persistence is best-effort.
  }
}

export function forgetLastStudioProjectId(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LAST_STUDIO_PROJECT_KEY);
    notifyStudioSessionChanged();
  } catch {
    // Storage can be unavailable in embedded browsers; reset still works server-side.
  }
}

export function normalizeStudioNavigationPath(path: string | undefined): string {
  if (!path) return '';
  if (!path.startsWith('/')) return '';
  if (path.startsWith('//')) return '';
  return path;
}

export function saveStudioDispatchSession(session: Omit<StudioDispatchSession, 'updatedAt'>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      STUDIO_DISPATCH_SESSION_KEY,
      JSON.stringify({ ...session, updatedAt: new Date().toISOString() }),
    );
    notifyStudioSessionChanged();
  } catch {
    // Storage can be unavailable in embedded browsers; the dispatch still works.
  }
}

export function readStudioDispatchSession(): StudioDispatchSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STUDIO_DISPATCH_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StudioDispatchSession>;
    if (!parsed.projectId) return null;
    return {
      projectId: parsed.projectId,
      pageId: parsed.pageId,
      pageName: parsed.pageName,
      navigationPath: parsed.navigationPath,
      studioReturnPath: parsed.studioReturnPath,
      updatedAt: parsed.updatedAt || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function clearStudioDispatchSession(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STUDIO_DISPATCH_SESSION_KEY);
    notifyStudioSessionChanged();
  } catch {
    // Storage can be unavailable in embedded browsers; dismissal is best-effort.
  }
}
