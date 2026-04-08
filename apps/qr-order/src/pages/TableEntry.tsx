import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSessionStore } from '../store/session.store';
import { apiUrl } from '../lib/api';

export default function TableEntry() {
  const { tableId } = useParams<{ tableId: string }>();
  const navigate = useNavigate();
  const setSession = useSessionStore((s) => s.setSession);

  useEffect(() => {
    if (!tableId) return;
    fetch(apiUrl(`/public/table/${tableId}`))
      .then((r) => r.json())
      .then((data: { id: string; branchId: string; branchName: string; tableNumber: string }) => {
        setSession({
          tableId: data.id,
          branchId: data.branchId,
          branchName: data.branchName,
          tableNumber: data.tableNumber,
        });
        void navigate('/menu', { replace: true });
      })
      .catch(() => void navigate('/menu', { replace: true }));
  }, [tableId, navigate, setSession]);

  return (
    <div className="flex items-center justify-center h-screen bg-[#0D0D0D]">
      <div className="text-center">
        <div className="w-16 h-16 bg-[#C8FF00] flex items-center justify-center mx-auto mb-4 animate-pulse">
          <span className="font-display text-[#0D0D0D] text-3xl">R</span>
        </div>
        <p className="text-sm text-[#666] font-body">Loading menu...</p>
      </div>
    </div>
  );
}
