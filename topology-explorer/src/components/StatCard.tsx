type StatCardProps = {
  label: string
  value: number
}

const StatCard = ({ label, value }: StatCardProps) => (
  <div className="stat-card">
    <span className="stat-label">{label}</span>
    <strong className="stat-value">{value}</strong>
  </div>
)

export default StatCard
