import { DemoCommunityPage } from './pages/DemoCommunityPage';
import { TestDrivePage } from './pages/TestDrivePage';
import './App.css';

export default function App() {
  return window.location.pathname === '/demo/test-drive'
    ? <TestDrivePage />
    : <DemoCommunityPage />;
}
