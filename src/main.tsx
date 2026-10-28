import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { WorkspaceProvider } from './state/workspace';
import { AiSessionProvider } from './state/ai-session-2026.10.24';
import './styles.css';
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WorkspaceProvider>
      <AiSessionProvider><App /></AiSessionProvider>
    </WorkspaceProvider>
  </React.StrictMode>,
);
