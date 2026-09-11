import { GuideProvider } from 'pointto';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { manifest } from './manifest';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GuideProvider
      manifest={manifest}
      voice={{ tokenEndpoint: 'http://localhost:8787/api/voice/token', appName: 'the pointto playground' }}
    >
      <App />
    </GuideProvider>
  </StrictMode>,
);
