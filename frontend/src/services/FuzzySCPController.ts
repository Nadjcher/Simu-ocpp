// services/FuzzySCPController.ts - VERSION COMPLÈTE

/**
 * Contrôleur Fuzzy pour Smart Charging Profile
 * Implémente une logique floue pour optimiser la charge des véhicules électriques
 */

export interface FuzzyInput {
    gridLoad: number;        // 0-100% charge du réseau
    batterySOC: number;      // 0-100% état de charge
    timeOfDay: number;       // 0-24 heures
    solarProduction: number; // en Watts
    electricityPrice: number; // €/kWh
    temperature: number;     // °C
}

export interface FuzzyOutput {
    chargingPowerW: number;
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    explanation: string;
}

type FuzzyLevel = 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
type TimeCategory = 'NIGHT' | 'MORNING' | 'MIDDAY' | 'EVENING' | 'PEAK';

interface FuzzyRule {
    conditions: {
        gridLoad?: FuzzyLevel;
        soc?: FuzzyLevel;
        timeCategory?: TimeCategory;
        solar?: FuzzyLevel;
        price?: FuzzyLevel;
        temperature?: FuzzyLevel;
    };
    output: {
        powerLevel: FuzzyLevel;
        priority: FuzzyOutput['priority'];
    };
    weight: number;
}

export class FuzzySCPController {
    private fuzzyRules: FuzzyRule[] = [];
    private maxChargingPowerW: number = 22000; // 22 kW par défaut
    private fuzzyIntensity: number = 1.0; // 0 = désactivé, 1 = max effet
    private debugMode: boolean = false;

    constructor(maxPowerW: number = 22000) {
        this.maxChargingPowerW = maxPowerW;
        this.initializeFuzzyRules();

        // Activer le debug si configuré
        if (typeof window !== 'undefined' && localStorage.getItem('DEBUG_FUZZY') === 'true') {
            this.debugMode = true;
        }
    }

    /**
     * Initialise les règles floues complètes
     */
    private initializeFuzzyRules(): void {
        this.fuzzyRules = [
            // ========== RÈGLES CRITIQUES ==========

            // Règle 1: Urgence charge basse + prix bas
            {
                conditions: {
                    soc: 'VERY_LOW',
                    price: 'LOW'
                },
                output: {
                    powerLevel: 'VERY_HIGH',
                    priority: 'CRITICAL'
                },
                weight: 1.0
            },

            // Règle 2: Charge très basse à tout moment
            {
                conditions: {
                    soc: 'VERY_LOW'
                },
                output: {
                    powerLevel: 'HIGH',
                    priority: 'CRITICAL'
                },
                weight: 0.95
            },

            // ========== RÈGLES SOLAIRES ==========

            // Règle 3: Production solaire élevée = maximiser utilisation
            {
                conditions: {
                    solar: 'HIGH',
                    gridLoad: 'LOW'
                },
                output: {
                    powerLevel: 'HIGH',
                    priority: 'HIGH'
                },
                weight: 0.9
            },

            // Règle 4: Midi + production solaire maximale
            {
                conditions: {
                    timeCategory: 'MIDDAY',
                    solar: 'VERY_HIGH'
                },
                output: {
                    powerLevel: 'VERY_HIGH',
                    priority: 'HIGH'
                },
                weight: 0.9
            },

            // Règle 5: Production solaire moyenne + SoC moyen
            {
                conditions: {
                    solar: 'MEDIUM',
                    soc: 'MEDIUM'
                },
                output: {
                    powerLevel: 'MEDIUM',
                    priority: 'MEDIUM'
                },
                weight: 0.7
            },

            // ========== RÈGLES HEURES DE POINTE ==========

            // Règle 6: Heures de pointe + charge réseau élevée
            {
                conditions: {
                    timeCategory: 'PEAK',
                    gridLoad: 'HIGH'
                },
                output: {
                    powerLevel: 'LOW',
                    priority: 'LOW'
                },
                weight: 0.95
            },

            // Règle 7: Heures de pointe + prix élevé
            {
                conditions: {
                    timeCategory: 'PEAK',
                    price: 'HIGH'
                },
                output: {
                    powerLevel: 'LOW',
                    priority: 'LOW'
                },
                weight: 0.9
            },

            // Règle 8: Soir + charge réseau élevée
            {
                conditions: {
                    timeCategory: 'EVENING',
                    gridLoad: 'HIGH'
                },
                output: {
                    powerLevel: 'MEDIUM',
                    priority: 'MEDIUM'
                },
                weight: 0.8
            },

            // ========== RÈGLES NOCTURNES ==========

            // Règle 9: Nuit + tarif bas = charge optimale
            {
                conditions: {
                    timeCategory: 'NIGHT',
                    price: 'LOW'
                },
                output: {
                    powerLevel: 'HIGH',
                    priority: 'HIGH'
                },
                weight: 0.85
            },

            // Règle 10: Nuit + SoC bas
            {
                conditions: {
                    timeCategory: 'NIGHT',
                    soc: 'LOW'
                },
                output: {
                    powerLevel: 'HIGH',
                    priority: 'HIGH'
                },
                weight: 0.8
            },

            // Règle 11: Nuit standard
            {
                conditions: {
                    timeCategory: 'NIGHT'
                },
                output: {
                    powerLevel: 'MEDIUM',
                    priority: 'MEDIUM'
                },
                weight: 0.7
            },

            // ========== RÈGLES SOC ÉLEVÉ ==========

            // Règle 12: SOC élevé = charge lente
            {
                conditions: {
                    soc: 'HIGH'
                },
                output: {
                    powerLevel: 'LOW',
                    priority: 'LOW'
                },
                weight: 0.7
            },

            // Règle 13: SOC très élevé + pas de solaire = arrêt proche
            {
                conditions: {
                    soc: 'VERY_HIGH',
                    solar: 'LOW'
                },
                output: {
                    powerLevel: 'VERY_LOW',
                    priority: 'LOW'
                },
                weight: 0.85
            },

            // Règle 14: SOC très élevé (général)
            {
                conditions: {
                    soc: 'VERY_HIGH'
                },
                output: {
                    powerLevel: 'VERY_LOW',
                    priority: 'LOW'
                },
                weight: 0.8
            },

            // ========== RÈGLES TEMPÉRATURE ==========

            // Règle 15: Température très basse = réduction pour protéger batterie
            {
                conditions: {
                    temperature: 'VERY_LOW'
                },
                output: {
                    powerLevel: 'LOW',
                    priority: 'MEDIUM'
                },
                weight: 0.8
            },

            // Règle 16: Température très basse + SOC bas = charge modérée
            {
                conditions: {
                    temperature: 'VERY_LOW',
                    soc: 'LOW'
                },
                output: {
                    powerLevel: 'MEDIUM',
                    priority: 'HIGH'
                },
                weight: 0.75
            },

            // Règle 17: Température très élevée = réduction
            {
                conditions: {
                    temperature: 'VERY_HIGH'
                },
                output: {
                    powerLevel: 'LOW',
                    priority: 'MEDIUM'
                },
                weight: 0.8
            },

            // Règle 18: Température très élevée + SOC bas = charge modérée
            {
                conditions: {
                    temperature: 'VERY_HIGH',
                    soc: 'LOW'
                },
                output: {
                    powerLevel: 'MEDIUM',
                    priority: 'HIGH'
                },
                weight: 0.7
            },

            // ========== RÈGLES PRIX ==========

            // Règle 19: Prix très élevé = minimiser
            {
                conditions: {
                    price: 'VERY_HIGH'
                },
                output: {
                    powerLevel: 'VERY_LOW',
                    priority: 'LOW'
                },
                weight: 0.85
            },

            // Règle 20: Prix très bas = maximiser
            {
                conditions: {
                    price: 'VERY_LOW'
                },
                output: {
                    powerLevel: 'HIGH',
                    priority: 'HIGH'
                },
                weight: 0.85
            },

            // ========== RÈGLES CHARGE RÉSEAU ==========

            // Règle 21: Réseau surchargé = arrêt
            {
                conditions: {
                    gridLoad: 'VERY_HIGH'
                },
                output: {
                    powerLevel: 'VERY_LOW',
                    priority: 'LOW'
                },
                weight: 0.95
            },

            // Règle 22: Réseau peu chargé = opportunité
            {
                conditions: {
                    gridLoad: 'VERY_LOW'
                },
                output: {
                    powerLevel: 'HIGH',
                    priority: 'HIGH'
                },
                weight: 0.8
            },

            // ========== RÈGLES COMBINÉES COMPLEXES ==========

            // Règle 23: Matin + SoC moyen + prix moyen
            {
                conditions: {
                    timeCategory: 'MORNING',
                    soc: 'MEDIUM',
                    price: 'MEDIUM'
                },
                output: {
                    powerLevel: 'MEDIUM',
                    priority: 'MEDIUM'
                },
                weight: 0.6
            },

            // Règle 24: Optimisation solaire + réseau
            {
                conditions: {
                    solar: 'HIGH',
                    gridLoad: 'MEDIUM',
                    soc: 'MEDIUM'
                },
                output: {
                    powerLevel: 'HIGH',
                    priority: 'HIGH'
                },
                weight: 0.75
            },

            // Règle 25: Conditions idéales
            {
                conditions: {
                    gridLoad: 'LOW',
                    price: 'LOW',
                    temperature: 'MEDIUM'
                },
                output: {
                    powerLevel: 'VERY_HIGH',
                    priority: 'HIGH'
                },
                weight: 0.9
            }
        ];
    }

    /**
     * Calcule la puissance de charge optimale avec logique floue
     */
    calculateOptimalChargingRate(input: FuzzyInput): FuzzyOutput {
        if (this.debugMode) {
            console.log('🔮 Fuzzy Input:', input);
        }

        // Fuzzification des entrées
        const fuzzifiedInput = this.fuzzifyInputs(input);

        // Application des règles et agrégation
        const ruleOutputs = this.applyRules(fuzzifiedInput, input);

        // Défuzzification
        const output = this.defuzzify(ruleOutputs, input);

        // Application de l'intensité fuzzy
        if (this.fuzzyIntensity < 1.0) {
            const baselinePower = this.calculateBaselinePower(input);
            output.chargingPowerW = Math.round(
                baselinePower + (output.chargingPowerW - baselinePower) * this.fuzzyIntensity
            );
        }

        if (this.debugMode) {
            console.log('🎯 Fuzzy Output:', output);
        }

        return output;
    }

    /**
     * Fuzzifie les entrées
     */
    private fuzzifyInputs(input: FuzzyInput): {
        gridLoad: Map<FuzzyLevel, number>;
        soc: Map<FuzzyLevel, number>;
        timeCategory: Map<TimeCategory, number>;
        solar: Map<FuzzyLevel, number>;
        price: Map<FuzzyLevel, number>;
        temperature: Map<FuzzyLevel, number>;
    } {
        return {
            gridLoad: this.fuzzifyPercentage(input.gridLoad),
            soc: this.fuzzifyPercentage(input.batterySOC),
            timeCategory: this.fuzzifyTime(input.timeOfDay),
            solar: this.fuzzifySolar(input.solarProduction),
            price: this.fuzzifyPrice(input.electricityPrice),
            temperature: this.fuzzifyTemperature(input.temperature)
        };
    }

    /**
     * Fonction d'appartenance trapézoïdale/triangulaire pour les pourcentages
     */
    private fuzzifyPercentage(value: number): Map<FuzzyLevel, number> {
        const membership = new Map<FuzzyLevel, number>();

        // VERY_LOW: 0-20
        membership.set('VERY_LOW', this.triangularMembership(value, -10, 10, 20));

        // LOW: 10-40
        membership.set('LOW', this.triangularMembership(value, 10, 25, 40));

        // MEDIUM: 30-70
        membership.set('MEDIUM', this.triangularMembership(value, 30, 50, 70));

        // HIGH: 60-90
        membership.set('HIGH', this.triangularMembership(value, 60, 75, 90));

        // VERY_HIGH: 80-100
        membership.set('VERY_HIGH', this.triangularMembership(value, 80, 90, 110));

        return membership;
    }

    /**
     * Fuzzification du temps (heures de la journée)
     */
    private fuzzifyTime(hour: number): Map<TimeCategory, number> {
        const membership = new Map<TimeCategory, number>();

        // NIGHT: 22h-6h (prend en compte le passage minuit)
        if (hour >= 22 || hour < 6) {
            const nightValue = hour >= 22
                ? (24 - hour) / 2 + 1  // 22h->24h: descend de 1 à 0
                : 1 - hour / 6;         // 0h->6h: descend de 1 à 0
            membership.set('NIGHT', Math.max(0, Math.min(1, nightValue)));
        } else {
            membership.set('NIGHT', 0);
        }

        // MORNING: 6h-10h
        membership.set('MORNING', this.triangularMembership(hour, 4, 8, 11));

        // MIDDAY: 10h-15h
        membership.set('MIDDAY', this.triangularMembership(hour, 9, 12.5, 16));

        // EVENING: 15h-20h
        membership.set('EVENING', this.triangularMembership(hour, 14, 17.5, 21));

        // PEAK: 17h-21h (heures de pointe)
        membership.set('PEAK', this.triangularMembership(hour, 16, 19, 22));

        return membership;
    }

    /**
     * Fuzzification de la production solaire
     */
    private fuzzifySolar(solarW: number): Map<FuzzyLevel, number> {
        const membership = new Map<FuzzyLevel, number>();
        const maxSolar = 10000; // 10 kW max supposé
        const percentage = Math.min((solarW / maxSolar) * 100, 100);

        // Utilise la même logique que les pourcentages
        return this.fuzzifyPercentage(percentage);
    }

    /**
     * Fuzzification du prix de l'électricité
     */
    private fuzzifyPrice(priceEuroPerKWh: number): Map<FuzzyLevel, number> {
        const membership = new Map<FuzzyLevel, number>();

        // VERY_LOW: < 0.10 €/kWh
        if (priceEuroPerKWh < 0.10) {
            membership.set('VERY_LOW', 1.0 - (priceEuroPerKWh / 0.10));
        } else {
            membership.set('VERY_LOW', 0);
        }

        // LOW: 0.08-0.15 €/kWh
        membership.set('LOW', this.triangularMembership(priceEuroPerKWh, 0.06, 0.12, 0.16));

        // MEDIUM: 0.12-0.20 €/kWh
        membership.set('MEDIUM', this.triangularMembership(priceEuroPerKWh, 0.10, 0.16, 0.22));

        // HIGH: 0.18-0.30 €/kWh
        membership.set('HIGH', this.triangularMembership(priceEuroPerKWh, 0.16, 0.24, 0.32));

        // VERY_HIGH: > 0.25 €/kWh
        if (priceEuroPerKWh > 0.25) {
            membership.set('VERY_HIGH', Math.min(1.0, (priceEuroPerKWh - 0.25) / 0.15));
        } else {
            membership.set('VERY_HIGH', 0);
        }

        return membership;
    }

    /**
     * Fuzzification de la température
     */
    private fuzzifyTemperature(tempC: number): Map<FuzzyLevel, number> {
        const membership = new Map<FuzzyLevel, number>();

        // VERY_LOW: < -5°C
        membership.set('VERY_LOW', tempC < -5 ? 1.0 : this.triangularMembership(tempC, -15, -5, 0));

        // LOW: -5 à 10°C
        membership.set('LOW', this.triangularMembership(tempC, -7, 2.5, 12));

        // MEDIUM: 5 à 25°C
        membership.set('MEDIUM', this.triangularMembership(tempC, 3, 15, 27));

        // HIGH: 20 à 35°C
        membership.set('HIGH', this.triangularMembership(tempC, 18, 27.5, 37));

        // VERY_HIGH: > 35°C
        membership.set('VERY_HIGH', tempC > 35 ? 1.0 : this.triangularMembership(tempC, 30, 37.5, 45));

        return membership;
    }

    /**
     * Fonction d'appartenance triangulaire
     */
    private triangularMembership(value: number, left: number, center: number, right: number): number {
        if (value <= left || value >= right) return 0;
        if (value === center) return 1;
        if (value < center) return (value - left) / (center - left);
        return (right - value) / (right - center);
    }

    /**
     * Applique les règles floues
     */
    private applyRules(
        fuzzifiedInput: ReturnType<typeof this.fuzzifyInputs>,
        rawInput: FuzzyInput
    ): Array<{ rule: FuzzyRule; activation: number }> {
        const results: Array<{ rule: FuzzyRule; activation: number }> = [];

        for (const rule of this.fuzzyRules) {
            let activation = 1.0;

            // Calcul du degré d'activation (AND = min)
            if (rule.conditions.gridLoad !== undefined) {
                activation = Math.min(activation, fuzzifiedInput.gridLoad.get(rule.conditions.gridLoad) || 0);
            }
            if (rule.conditions.soc !== undefined) {
                activation = Math.min(activation, fuzzifiedInput.soc.get(rule.conditions.soc) || 0);
            }
            if (rule.conditions.timeCategory !== undefined) {
                activation = Math.min(activation, fuzzifiedInput.timeCategory.get(rule.conditions.timeCategory) || 0);
            }
            if (rule.conditions.solar !== undefined) {
                activation = Math.min(activation, fuzzifiedInput.solar.get(rule.conditions.solar) || 0);
            }
            if (rule.conditions.price !== undefined) {
                activation = Math.min(activation, fuzzifiedInput.price.get(rule.conditions.price) || 0);
            }
            if (rule.conditions.temperature !== undefined) {
                activation = Math.min(activation, fuzzifiedInput.temperature.get(rule.conditions.temperature) || 0);
            }

            // Appliquer le poids de la règle
            activation *= rule.weight;

            if (activation > 0.1) { // Seuil minimal d'activation
                results.push({ rule, activation });
            }
        }

        if (this.debugMode && results.length > 0) {
            console.log('🎲 Règles activées:', results.map(r => ({
                conditions: r.rule.conditions,
                activation: (r.activation * 100).toFixed(1) + '%'
            })));
        }

        return results;
    }

    /**
     * Défuzzification - Centre de gravité
     */
    private defuzzify(
        ruleOutputs: Array<{ rule: FuzzyRule; activation: number }>,
        input: FuzzyInput
    ): FuzzyOutput {
        if (ruleOutputs.length === 0) {
            return {
                chargingPowerW: this.calculateBaselinePower(input),
                priority: 'MEDIUM',
                explanation: 'Aucune règle fuzzy activée, utilisation du profil de base'
            };
        }

        // Calcul de la puissance moyenne pondérée
        let totalWeight = 0;
        let weightedPower = 0;
        let maxPriority: FuzzyOutput['priority'] = 'LOW';
        const explanations: string[] = [];
        const activatedRules: Map<string, number> = new Map();

        for (const { rule, activation } of ruleOutputs) {
            const power = this.powerLevelToWatts(rule.output.powerLevel);
            weightedPower += power * activation;
            totalWeight += activation;

            // Mise à jour de la priorité maximale
            if (this.comparePriority(rule.output.priority, maxPriority) > 0) {
                maxPriority = rule.output.priority;
            }

            // Agrégation des explications par niveau de puissance
            const key = rule.output.powerLevel;
            activatedRules.set(key, Math.max(activatedRules.get(key) || 0, activation));
        }

        // Génération des explications
        activatedRules.forEach((activation, powerLevel) => {
            if (activation > 0.3) {
                explanations.push(`${powerLevel} (${(activation * 100).toFixed(0)}%)`);
            }
        });

        const finalPower = totalWeight > 0 ? weightedPower / totalWeight : this.maxChargingPowerW / 2;

        // Ajustements basés sur les contraintes
        let adjustedPower = finalPower;

        // Contrainte solaire corrigée - on limite par la production disponible
        if (input.solarProduction > 100) {
            // Si on a du solaire, on peut l'utiliser mais sans dépasser notre besoin
            if (input.solarProduction >= finalPower) {
                // Assez de solaire pour couvrir le besoin
                explanations.push(`Solaire suffisant: ${(input.solarProduction/1000).toFixed(1)}kW`);
            } else {
                // Pas assez de solaire, on limite
                const solarLimit = input.solarProduction * 0.95; // 95% du solaire disponible
                if (adjustedPower > solarLimit && input.batterySOC > 50) {
                    // Si SoC > 50%, on privilégie le solaire uniquement
                    adjustedPower = solarLimit;
                    explanations.push(`Limité au solaire: ${(solarLimit/1000).toFixed(1)}kW`);
                } else {
                    // Si SoC bas, on complète avec le réseau
                    explanations.push(`Solaire + réseau: ${(input.solarProduction/1000).toFixed(1)}kW solaire`);
                }
            }
        }

        // Réduction pour température extrême
        if (input.temperature < -5) {
            adjustedPower *= 0.7;
            explanations.push('Réduction froid extrême (-30%)');
        } else if (input.temperature > 40) {
            adjustedPower *= 0.6;
            explanations.push('Réduction chaleur extrême (-40%)');
        } else if (input.temperature < 0 || input.temperature > 35) {
            adjustedPower *= 0.85;
            explanations.push('Réduction température (-15%)');
        }

        // Courbe de charge selon SOC (réduction progressive)
        if (input.batterySOC > 80) {
            const reduction = (input.batterySOC - 80) / 20; // 0 à 1
            adjustedPower *= (1 - reduction * 0.6); // Réduction jusqu'à 60%
            explanations.push(`SoC élevé (${input.batterySOC.toFixed(0)}%)`);
        } else if (input.batterySOC > 95) {
            adjustedPower *= 0.2; // Charge très lente au-dessus de 95%
            explanations.push('Charge finale lente');
        }

        // Contrainte réseau d'urgence
        if (input.gridLoad > 90) {
            adjustedPower = Math.min(adjustedPower, this.maxChargingPowerW * 0.1);
            explanations.push('⚠️ Délestage réseau');
            maxPriority = 'LOW';
        }

        // Optimisation prix
        if (input.electricityPrice > 0.30) {
            adjustedPower *= 0.5;
            explanations.push('Prix très élevé (-50%)');
        }

        return {
            chargingPowerW: Math.round(Math.max(0, Math.min(adjustedPower, this.maxChargingPowerW))),
            priority: maxPriority,
            explanation: explanations.length > 0 ? explanations.join(', ') : 'Charge standard'
        };
    }

    /**
     * Convertit un niveau fuzzy en puissance
     */
    private powerLevelToWatts(level: FuzzyLevel): number {
        const mapping = {
            'VERY_LOW': this.maxChargingPowerW * 0.1,   // 10%
            'LOW': this.maxChargingPowerW * 0.3,        // 30%
            'MEDIUM': this.maxChargingPowerW * 0.5,     // 50%
            'HIGH': this.maxChargingPowerW * 0.75,      // 75%
            'VERY_HIGH': this.maxChargingPowerW * 0.95  // 95%
        };
        return mapping[level];
    }

    /**
     * Compare les priorités
     */
    private comparePriority(a: FuzzyOutput['priority'], b: FuzzyOutput['priority']): number {
        const order = { 'LOW': 0, 'MEDIUM': 1, 'HIGH': 2, 'CRITICAL': 3 };
        return order[a] - order[b];
    }

    /**
     * Calcule la puissance de base sans fuzzy
     */
    private calculateBaselinePower(input: FuzzyInput): number {
        // Logique simple de base selon le SoC
        if (input.batterySOC < 20) {
            return this.maxChargingPowerW * 0.9;
        } else if (input.batterySOC < 50) {
            return this.maxChargingPowerW * 0.7;
        } else if (input.batterySOC < 80) {
            return this.maxChargingPowerW * 0.5;
        } else if (input.batterySOC < 95) {
            return this.maxChargingPowerW * 0.3;
        } else {
            return this.maxChargingPowerW * 0.1;
        }
    }

    /**
     * Définit l'intensité du mode fuzzy
     */
    setFuzzyIntensity(intensity: number): void {
        this.fuzzyIntensity = Math.max(0, Math.min(1, intensity));
    }

    /**
     * Obtient l'intensité actuelle
     */
    getFuzzyIntensity(): number {
        return this.fuzzyIntensity;
    }

    /**
     * Ajoute une règle personnalisée
     */
    addCustomRule(rule: FuzzyRule): void {
        this.fuzzyRules.push(rule);
    }

    /**
     * Supprime toutes les règles personnalisées et réinitialise
     */
    resetRules(): void {
        this.initializeFuzzyRules();
    }

    /**
     * Active/désactive le mode debug
     */
    setDebugMode(enabled: boolean): void {
        this.debugMode = enabled;
        if (typeof window !== 'undefined') {
            localStorage.setItem('DEBUG_FUZZY', enabled ? 'true' : 'false');
        }
    }

    /**
     * Obtient une recommandation textuelle basée sur les entrées
     */
    getRecommendation(input: FuzzyInput): string {
        const output = this.calculateOptimalChargingRate(input);
        const powerKW = (output.chargingPowerW / 1000).toFixed(1);

        let recommendation = `Charge recommandée: ${powerKW} kW\n`;
        recommendation += `Priorité: ${output.priority}\n`;
        recommendation += `Raison: ${output.explanation}\n`;

        // Recommandations supplémentaires
        if (input.batterySOC < 20) {
            recommendation += '\n⚠️ Batterie faible - charge urgente recommandée';
        }
        if (input.temperature < -5 || input.temperature > 40) {
            recommendation += '\n⚠️ Température extrême - charge réduite pour protéger la batterie';
        }
        if (input.gridLoad > 80) {
            recommendation += '\n⚠️ Réseau chargé - considérer report de charge';
        }
        if (input.solarProduction > 5000) {
            recommendation += '\n☀️ Bonne production solaire - moment idéal pour charger';
        }
        if (input.electricityPrice < 0.10) {
            recommendation += '\n💰 Tarif avantageux - profitez-en pour charger';
        }

        return recommendation;
    }

    /**
     * Simule différents scénarios pour tests
     */
    simulateScenarios(): Map<string, FuzzyOutput> {
        const scenarios = new Map<string, FuzzyInput>();

        // Scénario 1: Nuit, tarif bas
        scenarios.set('Nuit économique', {
            gridLoad: 20,
            batterySOC: 40,
            timeOfDay: 2,
            solarProduction: 0,
            electricityPrice: 0.08,
            temperature: 15
        });

        // Scénario 2: Midi, solaire max
        scenarios.set('Midi solaire', {
            gridLoad: 40,
            batterySOC: 60,
            timeOfDay: 12,
            solarProduction: 8000,
            electricityPrice: 0.15,
            temperature: 25
        });

        // Scénario 3: Heure de pointe
        scenarios.set('Heure de pointe', {
            gridLoad: 85,
            batterySOC: 50,
            timeOfDay: 19,
            solarProduction: 0,
            electricityPrice: 0.30,
            temperature: 20
        });

        // Scénario 4: Urgence batterie faible
        scenarios.set('Urgence SoC', {
            gridLoad: 50,
            batterySOC: 10,
            timeOfDay: 14,
            solarProduction: 2000,
            electricityPrice: 0.18,
            temperature: 22
        });

        // Scénario 5: Température extrême
        scenarios.set('Froid extrême', {
            gridLoad: 30,
            batterySOC: 35,
            timeOfDay: 8,
            solarProduction: 0,
            electricityPrice: 0.12,
            temperature: -10
        });

        const results = new Map<string, FuzzyOutput>();
        scenarios.forEach((input, name) => {
            results.set(name, this.calculateOptimalChargingRate(input));
        });

        return results;
    }
}