/**
 * Calculate total positions in a triangle given base length
 * Formula: N(N+1)/2 where N is the base length
 */
export function calculateTotalPositions(baseLength: number): number {
  if (baseLength < 3 || baseLength > 50) {
    throw new Error('Base length must be between 3 and 50');
  }
  return (baseLength * (baseLength + 1)) / 2;
}

/**
 * Calculate positions in a specific layer
 * 目的: レイヤー番号に対応する格子数を計算
 * Layer 1 (top/1等) = 1 position
 * Layer 2 (2等) = 2 positions
 * Layer 3 (3等) = 3 positions
 * ...
 * Layer N (N等/bottom) = N positions
 */
export function calculateLayerPositions(baseLength: number, layerNumber: number): number {
  if (layerNumber < 1 || layerNumber > baseLength) {
    throw new Error(`Layer number must be between 1 and ${baseLength}`);
  }
  // 層番号 = その層の格子数
  return layerNumber;
}

/**
 * Generate all layers for a campaign
 */
export interface LayerInfo {
  layerNumber: number;
  positionsCount: number;
}

export function generateLayers(baseLength: number): LayerInfo[] {
  const layers: LayerInfo[] = [];
  for (let layerNumber = 1; layerNumber <= baseLength; layerNumber++) {
    layers.push({
      layerNumber,
      positionsCount: calculateLayerPositions(baseLength, layerNumber),
    });
  }
  return layers;
}

/**
 * Generate all positions for a campaign
 */
export interface PositionInfo {
  layerNumber: number;
  rowNumber: number;
  colNumber: number;
}

export function generatePositions(baseLength: number): PositionInfo[] {
  const positions: PositionInfo[] = [];

  for (let layerNumber = 1; layerNumber <= baseLength; layerNumber++) {
    const positionsInLayer = calculateLayerPositions(baseLength, layerNumber);
    const rowNumber = layerNumber - 1;

    for (let colNumber = 0; colNumber < positionsInLayer; colNumber++) {
      positions.push({
        layerNumber,
        rowNumber,
        colNumber,
      });
    }
  }

  return positions;
}

/**
 * Validate layer prices object
 */
export function validateLayerPrices(
  layerPrices: Record<string, number>,
  baseLength: number
): boolean {
  // Check if all layers have prices
  for (let layer = 1; layer <= baseLength; layer++) {
    if (!layerPrices[layer.toString()] || layerPrices[layer.toString()] < 100) {
      return false;
    }
  }
  return true;
}

/**
 * Calculate total revenue for a campaign if all positions sold
 * @deprecated Use calculateTicketPrice instead
 */
export function calculateMaxRevenue(
  layerPrices: Record<string, number>,
  baseLength: number
): number {
  let total = 0;
  for (let layer = 1; layer <= baseLength; layer++) {
    const price = layerPrices[layer.toString()] || 0;
    const positions = calculateLayerPositions(baseLength, layer);
    total += price * positions;
  }
  return total;
}

/**
 * Calculate total prize cost
 * 目的: 総奖品成本を計算
 * I/O: layer_prices（各層の1人あたり奖品価値）→ 総成本
 * 計算式: 総成本 = Σ (layer_prices[N] × N)
 * 注意点: 層Nには N人いるので、layer_prices[N] × N が該当層の総成本
 */
export function calculateTotalPrizeCost(
  layerPrices: Record<string, number>,
  baseLength: number
): number {
  let total = 0;
  for (let layer = 1; layer <= baseLength; layer++) {
    const prizeValuePerPerson = layerPrices[layer.toString()] || 0;
    const positionsInLayer = layer; // 層Nには N人
    total += prizeValuePerPerson * positionsInLayer;
  }
  return total;
}

/**
 * Calculate ticket price (uniform price for all positions)
 * 目的: 抽奖单价を計算
 * I/O: layer_prices, profit_margin_percent → 抽奖单价
 * 計算式: 抽奖单价 = (総成本 / (1 - 利润率)) / 総格子数
 */
export function calculateTicketPrice(
  layerPrices: Record<string, number>,
  baseLength: number,
  profitMarginPercent: number
): number {
  const totalPrizeCost = calculateTotalPrizeCost(layerPrices, baseLength);
  const totalPositions = calculateTotalPositions(baseLength);

  // 奖池金额 = 総成本 / (1 - 利润率/100)
  const poolAmount = totalPrizeCost / (1 - profitMarginPercent / 100);

  // 抽奖单价 = 奖池金额 / 総格子数
  const ticketPrice = poolAmount / totalPositions;

  // 切り上げて整数にする（円単位）
  return Math.ceil(ticketPrice);
}

export default {
  calculateTotalPositions,
  calculateLayerPositions,
  generateLayers,
  generatePositions,
  validateLayerPrices,
  calculateMaxRevenue,
  calculateTotalPrizeCost,
  calculateTicketPrice,
};
