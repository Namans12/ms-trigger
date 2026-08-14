import { Outlet } from 'react-router-dom';
import { Topbar } from './Topbar';
import { Footer } from './Footer';

export function AppShell() {
  return (
    <div className="min-h-screen bg-background">
      <Topbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
