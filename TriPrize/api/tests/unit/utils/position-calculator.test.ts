import {
  calculateTotalPositions,
  calculateLayerPositions,
  generatePositions,
  validateLayerPrices,
  calculateMaxRevenue,
} from '../../../src/utils/position-calculator.util';

describe('Position Calculator Utils', () => {
  describe('calculateTotalPositions', () => {
    it('should calculate total positions for base length 3', () => {
      expect(calculateTotalPositions(3)).toBe(6);
    });

    it('should calculate total positions for base length 5', () => {
      expect(calculateTotalPositions(5)).toBe(15);
    });

    it('should calculate total positions for base length 10', () => {
      expect(calculateTotalPositions(10)).toBe(55);
    });

    it('should throw error for base length less than 3', () => {
      expect(() => calculateTotalPositions(2)).toThrow('Base length must be between 3 and 50');
    });

    it('should throw error for base length greater than 50', () => {
      expect(() => calculateTotalPositions(51)).toThrow('Base length must be between 3 and 50');
    });
  });

  describe('calculateLayerPositions', () => {
    it('should calculate positions for bottom layer', () => {
      expect(calculateLayerPositions(5, 1)).toBe(5);
    });

    it('should calculate positions for middle layer', () => {
      expect(calculateLayerPositions(5, 3)).toBe(3);
    });

    it('should calculate positions for top layer', () => {
      expect(calculateLayerPositions(5, 5)).toBe(1);
    });

    it('should throw error for invalid layer number', () => {
      expect(() => calculateLayerPositions(5, 0)).toThrow('Layer number must be between 1 and 5');
      expect(() => calculateLayerPositions(5, 6)).toThrow('Layer number must be between 1 and 5');
    });
  });

  describe('generatePositions', () => {
    it('should generate all positions for base length 3', () => {
      const positions = generatePositions(3);
      expect(positions).toHaveLength(6);

      // Layer 1 should have 3 positions
      const layer1 = positions.filter(p => p.layerNumber === 1);
      expect(layer1).toHaveLength(3);

      // Layer 2 should have 2 positions
      const layer2 = positions.filter(p => p.layerNumber === 2);
      expect(layer2).toHaveLength(2);

      // Layer 3 should have 1 position
      const layer3 = positions.filter(p => p.layerNumber === 3);
      expect(layer3).toHaveLength(1);
    });

    it('should generate positions with correct coordinates', () => {
      const positions = generatePositions(3);

      // Check first position
      expect(positions[0]).toEqual({
        layerNumber: 1,
        rowNumber: 0,
        colNumber: 0,
      });

      // Check last position (top)
      const topPosition = positions.find(p => p.layerNumber === 3);
      expect(topPosition).toEqual({
        layerNumber: 3,
        rowNumber: 2,
        colNumber: 0,
      });
    });
  });

  describe('validateLayerPrices', () => {
    it('should validate correct layer prices', () => {
      const layerPrices = {
        '1': 500,
        '2': 400,
        '3': 300,
      };
      expect(validateLayerPrices(layerPrices, 3)).toBe(true);
    });

    it('should reject missing layer prices', () => {
      const layerPrices = {
        '1': 500,
        '2': 400,
        // Missing layer 3
      };
      expect(validateLayerPrices(layerPrices, 3)).toBe(false);
    });

    it('should reject prices less than 100', () => {
      const layerPrices = {
        '1': 500,
        '2': 50, // Too low
        '3': 300,
      };
      expect(validateLayerPrices(layerPrices, 3)).toBe(false);
    });
  });

  describe('calculateMaxRevenue', () => {
    it('should calculate maximum revenue', () => {
      const layerPrices = {
        '1': 500,
        '2': 400,
        '3': 300,
      };
      // Layer 1: 3 positions * 500 = 1500
      // Layer 2: 2 positions * 400 = 800
      // Layer 3: 1 position * 300 = 300
      // Total: 2600
      expect(calculateMaxRevenue(layerPrices, 3)).toBe(2600);
    });

    it('should return 0 for missing prices', () => {
      const layerPrices = {};
      expect(calculateMaxRevenue(layerPrices, 3)).toBe(0);
    });
  });
});
