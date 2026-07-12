import type { DashboardAttentionItem } from '../../../types/dashboardAnalytics'
import { formatRequestDate, translateRequestStatus, translateRequestType } from '../../../utils/requests'

type DashboardAttentionListProps = {
  title: string
  items: DashboardAttentionItem[]
  emptyMessage: string
  actions?: (item: DashboardAttentionItem) => React.ReactNode
}

export function DashboardAttentionList({
  title,
  items,
  emptyMessage,
  actions,
}: DashboardAttentionListProps) {
  return (
    <section className="ds-card dashboard-analytics__chart-card" aria-label={title}>
      <h3 className="dashboard-analytics__chart-title">{title}</h3>

      {items.length === 0 ? (
        <p className="dashboard-analytics__chart-summary">{emptyMessage}</p>
      ) : (
        <ul className="dashboard-analytics__attention-list">
          {items.map((item) => (
            <li key={item.id} className="dashboard-analytics__attention-item">
              <div className="dashboard-analytics__attention-main">
                <p className="dashboard-analytics__attention-title">
                  {translateRequestType(item.requestType)} — {item.description}
                </p>
                <p className="dashboard-analytics__attention-meta">
                  {item.teacherFullName ? `${item.teacherFullName} · ` : ''}
                  {translateRequestStatus(item.status)} · {formatRequestDate(item.createdAt)}
                  {item.reminderCount ? ` · ${item.reminderCount} תזכורות` : ''}
                  {item.hasUnreadReminder ? ' · תזכורת חדשה' : ''}
                </p>
              </div>
              {actions ? actions(item) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
