import { useAuth } from "../contexts/AuthContext";

export const LogoutButton: React.FC<{
  mySessionId: string;
  copySessionId: () => void;
}> = ({ mySessionId, copySessionId }) => {
  const { user } = useAuth();

  return (
    <div className="flex items-center justify-between space-x-4 w-full">
      <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">
        Welcome,{" "}
        <span className="text-primary-400 font-semibold">{user?.email}</span>
      </span>
      <div className="flex items-center space-x-3">
        <span className="text-2xl font-bold text-primary-600 dark:text-primary-400 font-mono bg-gray-100 dark:bg-gray-800 px-3 py-1 rounded-lg border border-primary-500/20">
          {mySessionId}
        </span>
        <button
          onClick={copySessionId}
          className="text-gray-600 dark:text-gray-400 hover:text-primary-400 transition-colors p-2 rounded-lg hover:bg-primary-500/10"
          title="Copy Session ID"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
        </button>
      </div>
    </div>
  );
};
