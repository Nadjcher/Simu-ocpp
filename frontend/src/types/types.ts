// frontend/src/types/index.ts
export interface Session {
    id: string;
    title: string;
    chargePointId: string;
    ocppUrl: string;
    idTag?: string;
    connectorId: number;
    state: string;
    connected: boolean;
    authorized: boolean;
    charging: boolean;
    transactionId?: string;
    soc: number;
    targetSoc: number;
    batteryCapacity: number;
    activePower: number;
    offeredPower: number;
    sessionEnergy: number;
    sessionDuration: number;
    physicalLimit: number;
    scpLimit: number;
    fuzzyEnabled: boolean;
    fuzzyVariation: number;
    vehicleProfile?: VehicleProfile;
    startTime?: string;
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
    chargingCurve: Record<number, number>;
}

export interface OCPPMessage {
    sessionId: string;
    direction: 'SENT' | 'RECEIVED';
    action: string;
    payload: any;
    timestamp: string;
}

export interface PerformanceMetrics {
    activeSessions: number;
    totalSessions: number;
    cpuUsage: number;
    memoryUsage: number;
    messagesPerSecond: number;
    totalMessages: number;
    errors: number;
    averageLatency: number;
    throughput: number;
    timestamp: string;
}

export interface ChartPoint {
    timestamp: number;
    soc: number;
    activePower: number;
    offeredPower: number;
    state: string;
}

export interface TNRScenario {
    id: string;
    name: string;
    description: string;
    sessions: TNRSession[];
    createdAt: string;
    lastRun?: string;
    status?: 'success' | 'failed' | 'running';
}

export interface TNRSession {
    cpId: string;
    vehicle: string;
    startTime: string;
    duration: number;
    powerExpected: number;
    scpExpected: string[];
    messagesExpected: string[];
}