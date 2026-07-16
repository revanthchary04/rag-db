/**
 * Standalone pages (eval, metrics) live under this group so they can scroll.
 * Root globals lock html/body/#__next to 100vh + overflow:hidden for the chat console.
 * Scrollbar is hidden (trackpad/wheel/touch still scroll).
 */
export default function ScrollableShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <main
      id="main-content"
      className="h-full min-h-0 w-full overflow-x-hidden overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {children}
    </main>
  )
}
