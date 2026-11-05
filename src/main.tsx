import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { WorkspaceProvider } from './state/workspace';
import { bootstrapDesktopProject } from './state/desktop-bootstrap-2026.11.5';
import { AiSessionProvider } from './state/ai-session-2026.10.24';
import './styles.css';

const desktop = bootstrapDesktopProject();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WorkspaceProvider
      initialWorkspace={desktop.workspace}
      storageKey={desktop.storageKey}
      initialDirty={desktop.dirty}
    >
      <AiSessionProvider>
        <App desktopBootstrap={desktop} />
      </AiSessionProvider>
    </WorkspaceProvider>
  </React.StrictMode>,
);
