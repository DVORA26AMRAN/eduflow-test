type RequestDescriptionCellProps = {
  description: string
}

export function RequestDescriptionCell({ description }: RequestDescriptionCellProps) {
  const trimmed = description.trim()

  if (!trimmed) {
    return <span className="ds-table__description ds-table__description--empty">—</span>
  }

  return <span className="ds-table__description">{description}</span>
}
