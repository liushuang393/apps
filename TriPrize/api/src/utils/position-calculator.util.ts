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
 * Layer 1 (bottom) has baseLength positions, decreases by 1 for each upper layer
 */
export function calculateLayerPositions(baseLength: number, layerNumber: number): number {
  if (layerNumber < 1 || layerNumber > baseLength) {
    throw new Error(`Layer number must be between 1 and ${baseLength}`);
  }
  return baseLength - layerNumber + 1;
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

export default {
  calculateTotalPositions,
  calculateLayerPositions,
  generateLayers,
  generatePositions,
  validateLayerPrices,
  calculateMaxRevenue,
};
