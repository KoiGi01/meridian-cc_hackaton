import { GuideProvider } from 'pointto';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { manifest } from './manifest';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GuideProvider manifest={manifest}>
      <App />
    </GuideProvider>
  </StrictMode>,
);
