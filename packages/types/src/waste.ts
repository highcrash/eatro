export type WasteReason = 'SPOILAGE' | 'PREPARATION_ERROR' | 'OVERCOOKED' | 'CONTAMINATION' | 'EXPIRED' | 'OTHER';

export interface WasteLog {
  id: string;
  branchId: string;
  ingredientId: string;
  quantity: number;
  reason: WasteReason;
  notes: string | null;
  recordedById: string;
  createdAt: Date;
  ingredient?: { id: string; name: string; unit: string };
  recordedBy?: { id: string; name: string };
}

export interface CreateWasteLogDto {
  ingredientId: string;
  quantity: number;
  reason: WasteReason;
  notes?: string;
}
