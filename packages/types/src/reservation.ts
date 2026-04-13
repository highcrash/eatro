export type ReservationStatus = 'PENDING' | 'CONFIRMED' | 'ARRIVED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED';

export interface Reservation {
  id: string;
  branchId: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  date: string;
  timeSlot: string;
  partySize: number;
  status: ReservationStatus;
  tableId: string | null;
  tableIds: string | null; // JSON array of table IDs
  notes: string | null;
  confirmedById: string | null;
  confirmedAt: string | null;
  arrivedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  agreedTerms: boolean;
  reminderSentAt: string | null;
  createdAt: string;
  updatedAt: string;
  table?: { id: string; tableNumber: string; capacity: number } | null;
  confirmedBy?: { id: string; name: string } | null;
  customer?: { id: string; name: string; phone: string } | null;
}

export interface CreateReservationDto {
  customerName: string;
  customerPhone: string;
  customerId?: string;
  date: string;
  timeSlot: string;
  partySize: number;
  notes?: string;
  agreedTerms: boolean;
}

export interface ConfirmReservationDto {
  tableId?: string;
  tableIds?: string[];  // multiple table IDs
  timeSlot?: string;
  notes?: string;
}

export interface ReservationSlot {
  time: string;
  availableBookings: number;
  availablePersons: number;
  isFull: boolean;
}

export interface ReservationSettings {
  openingTime: string;
  closingTime: string;
  reservationSlotMinutes: number;
  reservationBlockMinutes: number;
  reservationMaxBookingsPerSlot: number;
  reservationMaxPersonsPerSlot: number;
  reservationAutoReserveMinutes: number;
  reservationLateThresholdMinutes: number;
  reservationSmsEnabled: boolean;
  reservationReminderMinutes: number;
  reservationSmsConfirmTemplate: string | null;
  reservationSmsRejectTemplate: string | null;
  reservationSmsReminderTemplate: string | null;
  reservationTermsOfService: string | null;
}
