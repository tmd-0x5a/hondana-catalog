import { DesktopLibrary } from "./DesktopLibrary.jsx";
import { MobileUpload } from "./MobileUpload.jsx";

export function App() {
  if (window.location.pathname === "/upload") return <MobileUpload initialMode="add" />;
  if (window.location.pathname === "/check") return <MobileUpload initialMode="check" />;
  return <DesktopLibrary />;
}
