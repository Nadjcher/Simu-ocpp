// frontend/src/types/index.ts
export interface Session {
    id: string;
    title: string;
    connected: boolean;
    state: SessionState;
    ocppUrl: string;
    chargePointId: string;
    connectorId: number;
    idTag?: string;
    authorized: boolean;
    transactionId?: string;
    charging?: boolean;
    parked?: boolean;
    plugged?: boolean;
    soc?: number;
    targetSoc?: number;
    batteryCapacity?: number;
    sessionEnergy?: number;
    activePower?: number;
    offeredPower?: number;
    physicalLimit?: number;
    scpLimit?: number;
    sessionDuration?: number;
    startTime?: Date;
    vehicleProfile?: VehicleProfile;
    fuzzyEnabled?: boolean;
    fuzzyVariation?: number;
    chartData?: ChartPoint[];
}

export enum SessionState {
    DISCONNECTED = 'DISCONNECTED',
    CONNECTED = 'CONNECTED',
    PREPARING = 'PREPARING',
    CHARGING = 'CHARGING',
    SUSPENDED_EV = 'SUSPENDED_EV',
    SUSPENDED_EVSE = 'SUSPENDED_EVSE',
    FINISHING = 'FINISHING',
    RESERVED = 'RESERVED',
    UNAVAILABLE = 'UNAVAILABLE',
    FAULTED = 'FAULTED'
}

export interface VehicleProfile {
    id: string;
    name: string;
    brand: string;
    model: string;
    year: number;
    batteryCapacity: number;
    maxACPower: number;
    maxDCPower: number;
    chargingCurve: Map<number, number>;
}

export interface OCPPMessage {
    sessionId: string;
    direction: MessageDirection;
    action: string;
    payload: any;
    timestamp: Date;
}

export enum MessageDirection {
    SENT = 'SENT',
    RECEIVED = 'RECEIVED'
}

export interface ChargingProfile {
    id: string;
    sessionId: string;
    startTime: Date;
    endTime: Date;
    targetSoc: number;
    optimizationType: OptimizationType;
    schedulePoints: ChargingSchedulePoint[];
    status: ProfileStatus;
}

export enum OptimizationType {
    STANDARD = 'STANDARD',
    COST = 'COST',
    GREEN_ENERGY = 'GREEN_ENERGY',
    FAST = 'FAST'
}

export enum ProfileStatus {
    ACTIVE = 'ACTIVE',
    PAUSED = 'PAUSED',
    COMPLETED = 'COMPLETED',
    CANCELLED = 'CANCELLED'
}

export interface ChargingSchedulePoint {
    startOffset: number;
    limit: number;
}

export interface PerformanceMetrics {
    timestamp: Date;
    cpuUsage: number;
    memoryUsage: number;
    messagesPerSecond: number;
    activeSessions: number;
    totalSessions: number;
    averageLatency: number;
    errors: number;
    throughput: number;
}

export interface ChartPoint {
    timestamp: number;
    soc: number;
    activePower: number;
    offeredPower: number;
    state: string;
}

export interface LogEntry {
    timestamp: Date;
    level: 'INFO' | 'WARNING' | 'ERROR' | 'DEBUG';
    sessionId?: string;
    message: string;
    details?: any;
}