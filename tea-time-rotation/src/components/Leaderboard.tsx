// No explicit React import needed with React 17+ JSX transform
import { formatCost } from '../utils';

export type LeaderboardEntry = {
  name: string;
  total_drinks_bought: number | null;
  drink_count: number | null;
  total_cost_sponsored: number | null;
  total_cost_consumed: number | null;
};

type CostField = 'total_cost_sponsored' | 'total_cost_consumed';
type CountField = 'total_drinks_bought' | 'drink_count';
type LeaderboardField = CountField | CostField;

const COST_COUNT_MAP: Record<CostField, CountField> = {
  total_cost_sponsored: 'total_drinks_bought',
  total_cost_consumed: 'drink_count',
};

function isCostField(field: LeaderboardField): field is CostField {
  return field === 'total_cost_sponsored' || field === 'total_cost_consumed';
}

interface LeaderboardProps {
  readonly entries: ReadonlyArray<LeaderboardEntry>;
  readonly field: LeaderboardField;
  readonly currentUserName?: string;
  readonly currentUserEntry?: LeaderboardEntry;
  readonly currentUserRank?: number;
}

const medalForIndex = (index: number): string => {
  if (index === 0) return '🥇';
  if (index === 1) return '🥈';
  return '🥉';
};

const containerClassByIndex = (index: number): string => {
  if (index === 0) return 'bg-yellow-50 border-yellow-200 text-yellow-900';
  if (index === 1) return 'bg-gray-50 border-gray-200 text-gray-800';
  return 'bg-amber-50 border-amber-200 text-amber-900';
};

function formatValue(entry: LeaderboardEntry, field: LeaderboardField): string {
  if (isCostField(field)) {
    const cost = entry[field] ?? 0;
    const countField = COST_COUNT_MAP[field];
    const count = entry[countField] ?? 0;
    return `${formatCost(cost)} (${count})`;
  }
  return String(entry[field] ?? 0);
}

function Leaderboard({ entries, field, currentUserName, currentUserEntry, currentUserRank }: LeaderboardProps) {
  const isCurrentUserInTop3 = currentUserName &&
    entries.some(entry => entry.name === currentUserName);

  return (
    <div className="space-y-2">
      {entries.length === 0 ? (
        <p className="text-gray-600">No entries yet.</p>
      ) : (
        <>
          {entries.map((entry, index) => (
            <div
              key={`${entry.name}-${index}`}
              className={`flex items-center justify-between border rounded-lg px-3 py-2 ${containerClassByIndex(index)}`}
            >
              <div className="flex items-center space-x-3">
                <span className="text-xl" aria-hidden>
                  {medalForIndex(index)}
                </span>
                <span className="font-medium">{entry.name}</span>
              </div>
              <div className="text-sm">
                <span className="font-semibold">{formatValue(entry, field)}</span>
              </div>
            </div>
          ))}

          {!isCurrentUserInTop3 && currentUserEntry && currentUserRank && (
            <div className="bg-gray-100 border-2 border-gray-300 rounded-lg px-3 py-2 mt-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <span className="text-lg font-bold text-gray-600">
                    #{currentUserRank}
                  </span>
                  <span className="font-medium text-gray-900">
                    {currentUserEntry.name} <span className="text-xs text-gray-600">(You)</span>
                  </span>
                </div>
                <div className="text-sm">
                  <span className="font-semibold text-gray-700">
                    {formatValue(currentUserEntry, field)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default Leaderboard;
