export default function PageHeader({
  title,
  subtitle = "",
  actions = null,
  className = "",
  actionsClassName = "",
}) {
  return (
    <header className={`page-header ${className}`.trim()}>
      <div className="page-header-copy">
        <h1 className="page-header-title">{title}</h1>
        {subtitle ? <p className="page-header-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className={`page-header-actions ${actionsClassName}`.trim()}>{actions}</div> : null}
    </header>
  );
}
