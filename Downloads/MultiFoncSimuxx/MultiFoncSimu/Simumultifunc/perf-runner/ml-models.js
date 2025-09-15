// backend/ml-models.js
class AnomalyDetector {
    constructor() {
        this.features = [];
        this.threshold = 0.05;
        this.windowSize = 100;
    }

    addDataPoint(metrics) {
        const features = this.extractFeatures(metrics);
        this.features.push(features);
        if (this.features.length > this.windowSize) {
            this.features.shift();
        }
    }

    extractFeatures(metrics) {
        return {
            powerEfficiency: metrics.energyKWh / (metrics.powerKW * metrics.duration),
            powerVariance: this.calculateVariance(metrics.powerSamples || []),
            voltageStability: Math.abs(metrics.voltageV - 230) / 230,
            currentImbalance: this.calculatePhaseImbalance(metrics),
            energyDrift: this.calculateEnergyDrift(metrics),
            timestamp: Date.now()
        };
    }

    detectAnomalies(features) {
        // Implémentation de Isolation Forest simplifiée
        const anomalyScore = this.calculateAnomalyScore(features);
        return anomalyScore > this.threshold;
    }

    calculateAnomalyScore(features) {
        // Z-Score multivarié
        if (this.features.length < 10) return 0;

        const mean = this.calculateMean();
        const std = this.calculateStd();

        let score = 0;
        for (const key in features) {
            if (typeof features[key] === 'number') {
                const zScore = Math.abs((features[key] - mean[key]) / std[key]);
                score = Math.max(score, zScore);
            }
        }

        return score / 3; // Normalisation
    }
}

class EnergyPredictor {
    constructor() {
        this.history = [];
        this.model = null;
    }

    predict(session) {
        const features = this.extractFeatures(session);

        // Modèle de régression simple
        const baseRate = features.avgPower;
        const efficiency = this.calculateEfficiency(features);
        const timeRemaining = this.estimateRemainingTime(features);

        return {
            finalEnergy: features.currentEnergy + (baseRate * timeRemaining * efficiency),
            confidence: this.calculateConfidence(features),
            timeRemaining: timeRemaining * 60, // en minutes
            efficiency: efficiency
        };
    }

    extractFeatures(session) {
        const duration = (Date.now() - session.startTime) / 1000 / 3600; // heures
        return {
            currentEnergy: session.metrics?.energyKWh || 0,
            avgPower: session.metrics?.powerKW || 7.4,
            duration: duration,
            soc: session.metrics?.soc || 20,
            temperature: 20, // À récupérer depuis API météo
            timeOfDay: new Date().getHours(),
            dayOfWeek: new Date().getDay()
        };
    }

    estimateRemainingTime(features) {
        // Estimation basée sur le SoC et la courbe de charge
        const targetSoc = 80;
        const socRate = 10; // %/heure estimé
        return Math.max(0, (targetSoc - features.soc) / socRate);
    }

    calculateEfficiency(features) {
        // Facteurs d'efficacité
        let efficiency = 0.92; // Base

        // Température
        if (features.temperature < 0) efficiency *= 0.85;
        else if (features.temperature > 30) efficiency *= 0.95;

        // Heure de la journée
        const isOffPeak = features.timeOfDay < 7 || features.timeOfDay > 22;
        if (isOffPeak) efficiency *= 1.02;

        return efficiency;
    }

    calculateConfidence(features) {
        // Confiance basée sur la quantité de données
        const dataPoints = this.history.filter(h => h.sessionId === features.sessionId).length;
        return Math.min(0.95, 0.5 + dataPoints * 0.05);
    }
}

module.exports = { AnomalyDetector, EnergyPredictor };