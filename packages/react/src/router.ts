export interface RouterAdapter {
  currentPath(): string;
  navigate(path: string): void;
}

/**
 * Default adapter. pushState alone does not notify React Router; dispatching
 * popstate afterwards does, and is harmless for apps that do not listen.
 * Host apps with a custom router supply their own adapter instead.
 */
export function createHistoryRouter(): RouterAdapter {
  return {
    currentPath: () => window.location.pathname,
    navigate: (path) => {
      window.history.pushState({}, '', path);
      window.dispatchEvent(new PopStateEvent('popstate'));
    },
  };
}
