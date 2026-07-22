import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { startRendererLongTaskMonitor } from './lib/performanceMonitor';

const isMarketingDemo = import.meta.env.VITE_MARKETING_DEMO === '1';

if (import.meta.env.DEV && !isMarketingDemo) {
  startRendererLongTaskMonitor();
}

const root = ReactDOM.createRoot(document.getElementById('root')!);

if (isMarketingDemo) {
  const MarketingDemo = React.lazy(() => import('./marketing/MarketingDemo'));
  root.render(
    <React.StrictMode>
      <React.Suspense fallback={null}>
        <MarketingDemo />
      </React.Suspense>
    </React.StrictMode>,
  );
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
