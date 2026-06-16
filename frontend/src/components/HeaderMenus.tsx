type HeaderMenusProps = {
  lessonLabel: string;
  userLabel: string;
  onLessons: () => void;
  onProgress: () => void;
  onMentor: () => void;
  onSignOut: () => void;
};

export function HeaderMenus({
  lessonLabel,
  userLabel,
  onLessons,
  onProgress,
  onMentor,
  onSignOut,
}: HeaderMenusProps) {
  return (
    <header className="app-header">
      <div>
        <div className="brand-title">Jargon</div>
        <div className="brand-subtitle">{lessonLabel || "Live tutor workspace"}</div>
      </div>

      <div className="header-group">
        <button type="button" className="glass-button" onClick={onLessons}>
          Lessons
        </button>
        <button type="button" className="glass-button" onClick={onProgress}>
          Progress
        </button>
        <button type="button" className="glass-button" onClick={onMentor}>
          Mentor
        </button>
      </div>

      <div className="header-group">
        <div className="status-pill">{userLabel}</div>
        <button type="button" className="ghost-button" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </header>
  );
}
