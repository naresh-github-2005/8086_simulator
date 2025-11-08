import React, { useState, useRef, useEffect } from 'react';
import { Play, Square, SkipForward, RotateCcw, Sun, Moon, Info } from 'lucide-react';

// Complete 8086 CPU Emulator
class CPU8086 {
  constructor() {
    this.reset();
  }

  reset() {
    // General Purpose Registers (16-bit)
    this.AX = 0; this.BX = 0; this.CX = 0; this.DX = 0;
    
    // Pointer and Index Registers
    this.SI = 0; this.DI = 0; this.BP = 0; this.SP = 0xFFFE;
    this.IP = 0;
    
    // Segment Registers
    this.CS = 0; this.DS = 0; this.ES = 0; this.SS = 0;
    
    // Flags Register
    this.flags = {
      CF: 0, PF: 0, AF: 0, ZF: 0,
      SF: 0, TF: 0, IF: 1, DF: 0, OF: 0
    };
    
    // 1MB Memory (20-bit address space)
    this.memory = new Uint8Array(0x100000);
    this.halted = false;
  }

  // 8-bit register access helpers
  getAL() { return this.AX & 0xFF; }
  getAH() { return (this.AX >> 8) & 0xFF; }
  setAL(val) { this.AX = (this.AX & 0xFF00) | (val & 0xFF); }
  setAH(val) { this.AX = (this.AX & 0x00FF) | ((val & 0xFF) << 8); }
  
  getBL() { return this.BX & 0xFF; }
  getBH() { return (this.BX >> 8) & 0xFF; }
  setBL(val) { this.BX = (this.BX & 0xFF00) | (val & 0xFF); }
  setBH(val) { this.BX = (this.BX & 0x00FF) | ((val & 0xFF) << 8); }
  
  getCL() { return this.CX & 0xFF; }
  getCH() { return (this.CX >> 8) & 0xFF; }
  setCL(val) { this.CX = (this.CX & 0xFF00) | (val & 0xFF); }
  setCH(val) { this.CX = (this.CX & 0x00FF) | ((val & 0xFF) << 8); }
  
  getDL() { return this.DX & 0xFF; }
  getDH() { return (this.DX >> 8) & 0xFF; }
  setDL(val) { this.DX = (this.DX & 0xFF00) | (val & 0xFF); }
  setDH(val) { this.DX = (this.DX & 0x00FF) | ((val & 0xFF) << 8); }

  // Physical address calculation: Physical = (Segment × 10h) + Offset
  getPhysicalAddress(segment, offset) {
    return ((segment << 4) + offset) & 0xFFFFF;
  }

  readByte(segment, offset) {
    const addr = this.getPhysicalAddress(segment, offset);
    return this.memory[addr];
  }

  writeByte(segment, offset, value) {
    const addr = this.getPhysicalAddress(segment, offset);
    this.memory[addr] = value & 0xFF;
  }

  readWord(segment, offset) {
    const low = this.readByte(segment, offset);
    const high = this.readByte(segment, offset + 1);
    return (high << 8) | low;
  }

  writeWord(segment, offset, value) {
    this.writeByte(segment, offset, value & 0xFF);
    this.writeByte(segment, offset + 1, (value >> 8) & 0xFF);
  }

  // Update flags based on result
  updateFlags(result, size = 16, op = null, operand1 = 0, operand2 = 0) {
    const mask = size === 8 ? 0xFF : 0xFFFF;
    const signBit = size === 8 ? 0x80 : 0x8000;
    
    result = result & mask;
    
    // Zero Flag
    this.flags.ZF = result === 0 ? 1 : 0;
    
    // Sign Flag (MSB)
    this.flags.SF = (result & signBit) ? 1 : 0;
    
    // Parity Flag (even number of 1s in low byte)
    let parity = 0;
    let temp = result & 0xFF;
    for (let i = 0; i < 8; i++) {
      if (temp & 1) parity++;
      temp >>= 1;
    }
    this.flags.PF = (parity % 2) === 0 ? 1 : 0;
    
    // Carry and Overflow for arithmetic operations
    if (op === 'add' || op === 'adc') {
      const carry = op === 'adc' ? this.flags.CF : 0;
      const actualResult = operand1 + operand2 + carry;
      this.flags.CF = (actualResult > mask) ? 1 : 0;
      
      const sign1 = operand1 & signBit;
      const sign2 = operand2 & signBit;
      const signRes = result & signBit;
      this.flags.OF = (sign1 === sign2 && sign1 !== signRes) ? 1 : 0;
      
      this.flags.AF = ((operand1 & 0x0F) + (operand2 & 0x0F) + carry) > 0x0F ? 1 : 0;
    } else if (op === 'sub' || op === 'sbb' || op === 'cmp') {
      const borrow = (op === 'sbb') ? this.flags.CF : 0;
      const actualResult = operand1 - operand2 - borrow;
      this.flags.CF = (actualResult < 0) ? 1 : 0;
      
      const sign1 = operand1 & signBit;
      const sign2 = operand2 & signBit;
      const signRes = result & signBit;
      this.flags.OF = (sign1 !== sign2 && sign1 !== signRes) ? 1 : 0;
      
      this.flags.AF = ((operand1 & 0x0F) - (operand2 & 0x0F) - borrow) < 0 ? 1 : 0;
    } else if (op === 'and' || op === 'or' || op === 'xor' || op === 'test') {
      this.flags.CF = 0;
      this.flags.OF = 0;
    } else if (op === 'inc') {
      const sign1 = operand1 & signBit;
      const signRes = result & signBit;
      this.flags.OF = (sign1 === 0 && signRes !== 0) ? 1 : 0;
      this.flags.AF = ((operand1 & 0x0F) + 1) > 0x0F ? 1 : 0;
    } else if (op === 'dec') {
      const sign1 = operand1 & signBit;
      const signRes = result & signBit;
      this.flags.OF = (sign1 !== 0 && signRes === 0) ? 1 : 0;
      this.flags.AF = ((operand1 & 0x0F) - 1) < 0 ? 1 : 0;
    }
  }

  // Get register value by index
  getReg16(index) {
    return [this.AX, this.CX, this.DX, this.BX, this.SP, this.BP, this.SI, this.DI][index];
  }

  setReg16(index, value) {
    value = value & 0xFFFF;
    switch(index) {
      case 0: this.AX = value; break;
      case 1: this.CX = value; break;
      case 2: this.DX = value; break;
      case 3: this.BX = value; break;
      case 4: this.SP = value; break;
      case 5: this.BP = value; break;
      case 6: this.SI = value; break;
      case 7: this.DI = value; break;
    }
  }

  getReg8(index) {
    return [this.getAL(), this.getCL(), this.getDL(), this.getBL(), 
            this.getAH(), this.getCH(), this.getDH(), this.getBH()][index];
  }

  setReg8(index, value) {
    value = value & 0xFF;
    switch(index) {
      case 0: this.setAL(value); break;
      case 1: this.setCL(value); break;
      case 2: this.setDL(value); break;
      case 3: this.setBL(value); break;
      case 4: this.setAH(value); break;
      case 5: this.setCH(value); break;
      case 6: this.setDH(value); break;
      case 7: this.setBH(value); break;
    }
  }

  // Interrupt handling
  interrupt(intNum) {
    if (intNum === 0x10) {
      return this.handleVideoInterrupt();
    } else if (intNum === 0x21) {
      return this.handleDOSInterrupt();
    }
    return null;
  }

  handleVideoInterrupt() {
    const ah = this.getAH();
    if (ah === 0x0E) {
      // Teletype output
      const char = String.fromCharCode(this.getAL());
      return { type: 'output', data: char };
    } else if (ah === 0x13) {
      // Write string
      let output = '';
      const count = this.CX;
      const offset = this.BP;
      for (let i = 0; i < count; i++) {
        const char = this.readByte(this.ES, offset + i);
        output += String.fromCharCode(char);
      }
      return { type: 'output', data: output };
    }
    return null;
  }

  handleDOSInterrupt() {
    const ah = this.getAH();
    if (ah === 0x09) {
      // Print string ($ terminated)
      let output = '';
      let offset = this.DX;
      while (true) {
        const char = this.readByte(this.DS, offset);
        if (char === 0x24) break;
        output += String.fromCharCode(char);
        offset++;
      }
      return { type: 'output', data: output };
    } else if (ah === 0x02) {
      // Print character
      const char = String.fromCharCode(this.getDL());
      return { type: 'output', data: char };
    } else if (ah === 0x4C) {
      // Exit program
      this.halted = true;
      return { type: 'halt' };
    }
    return null;
  }

  // Main execution step
  step() {
    if (this.halted) return null;
    
    const opcode = this.readByte(this.CS, this.IP);
    this.IP = (this.IP + 1) & 0xFFFF;
    
    return this.executeInstruction(opcode);
  }

  executeInstruction(opcode) {
    // MOV immediate to register (B0-BF)
    if (opcode >= 0xB0 && opcode <= 0xBF) {
      const reg = opcode & 0x07;
      const wide = opcode & 0x08;
      
      if (wide) {
        const value = this.readWord(this.CS, this.IP);
        this.IP = (this.IP + 2) & 0xFFFF;
        this.setReg16(reg, value);
      } else {
        const value = this.readByte(this.CS, this.IP);
        this.IP = (this.IP + 1) & 0xFFFF;
        this.setReg8(reg, value);
      }
      return null;
    }

    // MOV reg/mem to/from register (88-8B)
    if (opcode >= 0x88 && opcode <= 0x8B) {
      const modrm = this.readByte(this.CS, this.IP);
      this.IP = (this.IP + 1) & 0xFFFF;
      
      const d = (opcode >> 1) & 1; // Direction
      const w = opcode & 1; // Word/byte
      const mod = (modrm >> 6) & 3;
      const reg = (modrm >> 3) & 7;
      const rm = modrm & 7;
      
      if (mod === 3) { // Register to register
        if (w) {
          const val = d ? this.getReg16(rm) : this.getReg16(reg);
          d ? this.setReg16(reg, val) : this.setReg16(rm, val);
        } else {
          const val = d ? this.getReg8(rm) : this.getReg8(reg);
          d ? this.setReg8(reg, val) : this.setReg8(rm, val);
        }
      }
      return null;
    }

    // MOV to segment register (8E)
    if (opcode === 0x8E) {
      const modrm = this.readByte(this.CS, this.IP);
      this.IP = (this.IP + 1) & 0xFFFF;
      const sreg = (modrm >> 3) & 0x03;
      const rm = modrm & 0x07;
      
      const value = (modrm >> 6) === 3 ? this.getReg16(rm) : 0;
      
      switch(sreg) {
        case 0: this.ES = value; break;
        case 2: this.SS = value; break;
        case 3: this.DS = value; break;
      }
      return null;
    }

    // MOV from segment register (8C)
    if (opcode === 0x8C) {
      const modrm = this.readByte(this.CS, this.IP);
      this.IP = (this.IP + 1) & 0xFFFF;
      const sreg = (modrm >> 3) & 0x03;
      const rm = modrm & 0x07;
      
      let value = 0;
      switch(sreg) {
        case 0: value = this.ES; break;
        case 1: value = this.CS; break;
        case 2: value = this.SS; break;
        case 3: value = this.DS; break;
      }
      
      if ((modrm >> 6) === 3) {
        this.setReg16(rm, value);
      }
      return null;
    }

    // ADD (00-05)
    if (opcode >= 0x00 && opcode <= 0x05) {
      if (opcode === 0x01 || opcode === 0x03) {
        const modrm = this.readByte(this.CS, this.IP);
        this.IP = (this.IP + 1) & 0xFFFF;
        
        if ((modrm >> 6) === 3) {
          const reg1 = (modrm >> 3) & 7;
          const reg2 = modrm & 7;
          
          if (opcode === 0x01) {
            const val1 = this.getReg16(reg2);
            const val2 = this.getReg16(reg1);
            const result = (val1 + val2) & 0xFFFF;
            this.updateFlags(result, 16, 'add', val1, val2);
            this.setReg16(reg2, result);
          } else {
            const val1 = this.getReg16(reg1);
            const val2 = this.getReg16(reg2);
            const result = (val1 + val2) & 0xFFFF;
            this.updateFlags(result, 16, 'add', val1, val2);
            this.setReg16(reg1, result);
          }
        }
      } else if (opcode === 0x04) {
        const imm = this.readByte(this.CS, this.IP);
        this.IP = (this.IP + 1) & 0xFFFF;
        const result = (this.getAL() + imm) & 0xFF;
        this.updateFlags(result, 8, 'add', this.getAL(), imm);
        this.setAL(result);
      } else if (opcode === 0x05) {
        const imm = this.readWord(this.CS, this.IP);
        this.IP = (this.IP + 2) & 0xFFFF;
        const result = (this.AX + imm) & 0xFFFF;
        this.updateFlags(result, 16, 'add', this.AX, imm);
        this.AX = result;
      }
      return null;
    }

    // ADC (10-15)
    if (opcode >= 0x10 && opcode <= 0x15) {
      if (opcode === 0x11) {
        const modrm = this.readByte(this.CS, this.IP);
        this.IP = (this.IP + 1) & 0xFFFF;
        
        if ((modrm >> 6) === 3) {
          const reg1 = (modrm >> 3) & 7;
          const reg2 = modrm & 7;
          const val1 = this.getReg16(reg2);
          const val2 = this.getReg16(reg1);
          const result = (val1 + val2 + this.flags.CF) & 0xFFFF;
          this.updateFlags(result, 16, 'adc', val1, val2);
          this.setReg16(reg2, result);
        }
      } else if (opcode === 0x15) {
        const imm = this.readWord(this.CS, this.IP);
        this.IP = (this.IP + 2) & 0xFFFF;
        const result = (this.AX + imm + this.flags.CF) & 0xFFFF;
        this.updateFlags(result, 16, 'adc', this.AX, imm);
        this.AX = result;
      }
      return null;
    }

    // SUB (28-2D)
    if (opcode >= 0x28 && opcode <= 0x2D) {
      if (opcode === 0x29 || opcode === 0x2B) {
        const modrm = this.readByte(this.CS, this.IP);
        this.IP = (this.IP + 1) & 0xFFFF;
        
        if ((modrm >> 6) === 3) {
          const reg1 = (modrm >> 3) & 7;
          const reg2 = modrm & 7;
          
          if (opcode === 0x29) {
            const val1 = this.getReg16(reg2);
            const val2 = this.getReg16(reg1);
            const result = (val1 - val2) & 0xFFFF;
            this.updateFlags(result, 16, 'sub', val1, val2);
            this.setReg16(reg2, result);
          } else {
            const val1 = this.getReg16(reg1);
            const val2 = this.getReg16(reg2);
            const result = (val1 - val2) & 0xFFFF;
            this.updateFlags(result, 16, 'sub', val1, val2);
            this.setReg16(reg1, result);
          }
        }
      } else if (opcode === 0x2C) {
        const imm = this.readByte(this.CS, this.IP);
        this.IP = (this.IP + 1) & 0xFFFF;
        const result = (this.getAL() - imm) & 0xFF;
        this.updateFlags(result, 8, 'sub', this.getAL(), imm);
        this.setAL(result);
      } else if (opcode === 0x2D) {
        const imm = this.readWord(this.CS, this.IP);
        this.IP = (this.IP + 2) & 0xFFFF;
        const result = (this.AX - imm) & 0xFFFF;
        this.updateFlags(result, 16, 'sub', this.AX, imm);
        this.AX = result;
      }
      return null;
    }

    // SBB (18-1D)
    if (opcode >= 0x18 && opcode <= 0x1D) {
      if (opcode === 0x19) {
        const modrm = this.readByte(this.CS, this.IP);
        this.IP = (this.IP + 1) & 0xFFFF;
        
        if ((modrm >> 6) === 3) {
          const reg1 = (modrm >> 3) & 7;
          const reg2 = modrm & 7;
          const val1 = this.getReg16(reg2);
          const val2 = this.getReg16(reg1);
          const result = (val1 - val2 - this.flags.CF) & 0xFFFF;
          this.updateFlags(result, 16, 'sbb', val1, val2);
          this.setReg16(reg2, result);
        }
      } else if (opcode === 0x1D) {
        const imm = this.readWord(this.CS, this.IP);
        this.IP = (this.IP + 2) & 0xFFFF;
        const result = (this.AX - imm - this.flags.CF) & 0xFFFF;
        this.updateFlags(result, 16, 'sbb', this.AX, imm);
        this.AX = result;
      }
      return null;
    }

    // CMP (38-3D)
    if (opcode >= 0x38 && opcode <= 0x3D) {
      if (opcode === 0x39 || opcode === 0x3B) {
        const modrm = this.readByte(this.CS, this.IP);
        this.IP = (this.IP + 1) & 0xFFFF;
        
        if ((modrm >> 6) === 3) {
          const reg1 = (modrm >> 3) & 7;
          const reg2 = modrm & 7;
          
          if (opcode === 0x39) {
            const val1 = this.getReg16(reg2);
            const val2 = this.getReg16(reg1);
            const result = (val1 - val2) & 0xFFFF;
            this.updateFlags(result, 16, 'cmp', val1, val2);
          } else {
            const val1 = this.getReg16(reg1);
            const val2 = this.getReg16(reg2);
            const result = (val1 - val2) & 0xFFFF;
            this.updateFlags(result, 16, 'cmp', val1, val2);
          }
        }
      } else if (opcode === 0x3C) {
        const imm = this.readByte(this.CS, this.IP);
        this.IP = (this.IP + 1) & 0xFFFF;
        const result = (this.getAL() - imm) & 0xFF;
        this.updateFlags(result, 8, 'cmp', this.getAL(), imm);
      } else if (opcode === 0x3D) {
        const imm = this.readWord(this.CS, this.IP);
        this.IP = (this.IP + 2) & 0xFFFF;
        const result = (this.AX - imm) & 0xFFFF;
        this.updateFlags(result, 16, 'cmp', this.AX, imm);
      }
      return null;
    }

    // AND (20-25)
    if (opcode >= 0x20 && opcode <= 0x25) {
      if (opcode === 0x21) {
        const modrm = this.readByte(this.CS, this.IP);
        this.IP = (this.IP + 1) & 0xFFFF;
        
        if ((modrm >> 6) === 3) {
          const reg1 = (modrm >> 3) & 7;
          const reg2 = modrm & 7;
          const val1 = this.getReg16(reg2);
          const val2 = this.getReg16(reg1);
          const result = val1 & val2;
          this.updateFlags(result, 16, 'and', val1, val2);
          this.setReg16(reg2, result);
        }
      } else if (opcode === 0x25) {
        const imm = this.readWord(this.CS, this.IP);
        this.IP = (this.IP + 2) & 0xFFFF;
        const result = this.AX & imm;
        this.updateFlags(result, 16, 'and', this.AX, imm);
        this.AX = result;
      }
      return null;
    }

    // OR (08-0D)
    if (opcode >= 0x08 && opcode <= 0x0D) {
      if (opcode === 0x09) {
        const modrm = this.readByte(this.CS, this.IP);
        this.IP = (this.IP + 1) & 0xFFFF;
        
        if ((modrm >> 6) === 3) {
          const reg1 = (modrm >> 3) & 7;
          const reg2 = modrm & 7;
          const val1 = this.getReg16(reg2);
          const val2 = this.getReg16(reg1);
          const result = val1 | val2;
          this.updateFlags(result, 16, 'or', val1, val2);
          this.setReg16(reg2, result);
        }
      } else if (opcode === 0x0D) {
        const imm = this.readWord(this.CS, this.IP);
        this.IP = (this.IP + 2) & 0xFFFF;
        const result = this.AX | imm;
        this.updateFlags(result, 16, 'or', this.AX, imm);
        this.AX = result;
      }
      return null;
    }

    // XOR (30-35)
    if (opcode >= 0x30 && opcode <= 0x35) {
      if (opcode === 0x31) {
        const modrm = this.readByte(this.CS, this.IP);
        this.IP = (this.IP + 1) & 0xFFFF;
        
        if ((modrm >> 6) === 3) {
          const reg1 = (modrm >> 3) & 7;
          const reg2 = modrm & 7;
          const val1 = this.getReg16(reg2);
          const val2 = this.getReg16(reg1);
          const result = val1 ^ val2;
          this.updateFlags(result, 16, 'xor', val1, val2);
          this.setReg16(reg2, result);
        }
      } else if (opcode === 0x35) {
        const imm = this.readWord(this.CS, this.IP);
        this.IP = (this.IP + 2) & 0xFFFF;
        const result = this.AX ^ imm;
        this.updateFlags(result, 16, 'xor', this.AX, imm);
        this.AX = result;
      }
      return null;
    }

    // TEST (84-85, A8-A9)
    if (opcode === 0x85) {
      const modrm = this.readByte(this.CS, this.IP);
      this.IP = (this.IP + 1) & 0xFFFF;
      
      if ((modrm >> 6) === 3) {
        const reg1 = (modrm >> 3) & 7;
        const reg2 = modrm & 7;
        const val1 = this.getReg16(reg2);
        const val2 = this.getReg16(reg1);
        const result = val1 & val2;
        this.updateFlags(result, 16, 'test', val1, val2);
      }
      return null;
    }

    if (opcode === 0xA9) {
      const imm = this.readWord(this.CS, this.IP);
      this.IP = (this.IP + 2) & 0xFFFF;
      const result = this.AX & imm;
      this.updateFlags(result, 16, 'test', this.AX, imm);
      return null;
    }

    // NOT (F6-F7 with reg=2)
    if (opcode === 0xF7) {
      const modrm = this.readByte(this.CS, this.IP);
      this.IP = (this.IP + 1) & 0xFFFF;
      const operation = (modrm >> 3) & 7;
      
      if (operation === 2 && (modrm >> 6) === 3) { // NOT
        const reg = modrm & 7;
        const val = this.getReg16(reg);
        this.setReg16(reg, (~val) & 0xFFFF);
      } else if (operation === 3 && (modrm >> 6) === 3) { // NEG
        const reg = modrm & 7;
        const val = this.getReg16(reg);
        const result = ((~val) + 1) & 0xFFFF;
        this.updateFlags(result, 16, 'sub', 0, val);
        this.setReg16(reg, result);
      } else if (operation === 4 && (modrm >> 6) === 3) { // MUL
        const reg = modrm & 7;
        const val = this.getReg16(reg);
        const result = this.AX * val;
        this.AX = result & 0xFFFF;
        this.DX = (result >> 16) & 0xFFFF;
        this.flags.CF = this.DX !== 0 ? 1 : 0;
        this.flags.OF = this.flags.CF;
      } else if (operation === 6 && (modrm >> 6) === 3) { // DIV
        const reg = modrm & 7;
        const divisor = this.getReg16(reg);
        if (divisor === 0) {
          return { type: 'error', message: 'Division by zero' };
        }
        const dividend = (this.DX << 16) | this.AX;
        this.AX = Math.floor(dividend / divisor) & 0xFFFF;
        this.DX = (dividend % divisor) & 0xFFFF;
      }
      return null;
    }

    // INC register (40-47)
    if (opcode >= 0x40 && opcode <= 0x47) {
      const reg = opcode & 0x07;
      const val = this.getReg16(reg);
      const result = (val + 1) & 0xFFFF;
      this.updateFlags(result, 16, 'inc', val, 1);
      this.setReg16(reg, result);
      return null;
    }

    // DEC register (48-4F)
    if (opcode >= 0x48 && opcode <= 0x4F) {
      const reg = opcode & 0x07;
      const val = this.getReg16(reg);
      const result = (val - 1) & 0xFFFF;
      this.updateFlags(result, 16, 'dec', val, 1);
      this.setReg16(reg, result);
      return null;
    }

    // PUSH register (50-57)
    if (opcode >= 0x50 && opcode <= 0x57) {
      const reg = opcode & 0x07;
      const val = this.getReg16(reg);
      this.SP = (this.SP - 2) & 0xFFFF;
      this.writeWord(this.SS, this.SP, val);
      return null;
    }

    // POP register (58-5F)
    if (opcode >= 0x58 && opcode <= 0x5F) {
      const reg = opcode & 0x07;
      const value = this.readWord(this.SS, this.SP);
      this.SP = (this.SP + 2) & 0xFFFF;
      this.setReg16(reg, value);
      return null;
    }

    // XCHG AX, reg (91-97)
    if (opcode >= 0x91 && opcode <= 0x97) {
      const reg = opcode & 0x07;
      const temp = this.AX;
      this.AX = this.getReg16(reg);
      this.setReg16(reg, temp);
      return null;
    }

    // Shift/Rotate instructions (D0-D3)
    if (opcode >= 0xD0 && opcode <= 0xD3) {
      const modrm = this.readByte(this.CS, this.IP);
      this.IP = (this.IP + 1) & 0xFFFF;
      const operation = (modrm >> 3) & 7;
      const w = opcode & 1;
      const v = (opcode >> 1) & 1;
      
      if ((modrm >> 6) === 3) {
        const reg = modrm & 7;
        const count = v ? (this.getCL() & 0x1F) : 1;
        
        if (w) {
          let val = this.getReg16(reg);
          for (let i = 0; i < count; i++) {
            if (operation === 4) { // SHL/SAL
              this.flags.CF = (val & 0x8000) ? 1 : 0;
              val = (val << 1) & 0xFFFF;
            } else if (operation === 5) { // SHR
              this.flags.CF = val & 1;
              val = val >> 1;
            } else if (operation === 7) { // SAR
              this.flags.CF = val & 1;
              val = (val >> 1) | (val & 0x8000);
            } else if (operation === 0) { // ROL
              const carry = (val & 0x8000) ? 1 : 0;
              val = ((val << 1) | carry) & 0xFFFF;
              this.flags.CF = carry;
            } else if (operation === 1) { // ROR
              const carry = val & 1;
              val = (val >> 1) | (carry ? 0x8000 : 0);
              this.flags.CF = carry;
            }
          }
          this.updateFlags(val, 16);
          this.setReg16(reg, val);
        }
      }
      return null;
    }

    // Conditional jumps (70-7F)
    if (opcode >= 0x70 && opcode <= 0x7F) {
      const offset = this.readByte(this.CS, this.IP);
      this.IP = (this.IP + 1) & 0xFFFF;
      const signedOffset = offset > 127 ? offset - 256 : offset;
      
      let jump = false;
      switch(opcode) {
        case 0x70: jump = this.flags.OF === 1; break; // JO
        case 0x71: jump = this.flags.OF === 0; break; // JNO
        case 0x72: jump = this.flags.CF === 1; break; // JB/JC
        case 0x73: jump = this.flags.CF === 0; break; // JNB/JNC
        case 0x74: jump = this.flags.ZF === 1; break; // JE/JZ
        case 0x75: jump = this.flags.ZF === 0; break; // JNE/JNZ
        case 0x76: jump = this.flags.CF === 1 || this.flags.ZF === 1; break; // JBE
        case 0x77: jump = this.flags.CF === 0 && this.flags.ZF === 0; break; // JA
        case 0x78: jump = this.flags.SF === 1; break; // JS
        case 0x79: jump = this.flags.SF === 0; break; // JNS
        case 0x7A: jump = this.flags.PF === 1; break; // JP/JPE
        case 0x7B: jump = this.flags.PF === 0; break; // JNP/JPO
        case 0x7C: jump = this.flags.SF !== this.flags.OF; break; // JL
        case 0x7D: jump = this.flags.SF === this.flags.OF; break; // JGE
        case 0x7E: jump = this.flags.ZF === 1 || this.flags.SF !== this.flags.OF; break; // JLE
        case 0x7F: jump = this.flags.ZF === 0 && this.flags.SF === this.flags.OF; break; // JG
      }
      
      if (jump) {
        this.IP = (this.IP + signedOffset) & 0xFFFF;
      }
      return null;
    }

    // JMP short (EB)
    if (opcode === 0xEB) {
      const offset = this.readByte(this.CS, this.IP);
      this.IP = (this.IP + 1) & 0xFFFF;
      const signedOffset = offset > 127 ? offset - 256 : offset;
      this.IP = (this.IP + signedOffset) & 0xFFFF;
      return null;
    }

    // JMP near (E9)
    if (opcode === 0xE9) {
      const offset = this.readWord(this.CS, this.IP);
      this.IP = (this.IP + 2) & 0xFFFF;
      const signedOffset = offset > 32767 ? offset - 65536 : offset;
      this.IP = (this.IP + signedOffset) & 0xFFFF;
      return null;
    }

    // CALL near (E8)
    if (opcode === 0xE8) {
      const offset = this.readWord(this.CS, this.IP);
      this.IP = (this.IP + 2) & 0xFFFF;
      const signedOffset = offset > 32767 ? offset - 65536 : offset;
      
      this.SP = (this.SP - 2) & 0xFFFF;
      this.writeWord(this.SS, this.SP, this.IP);
      this.IP = (this.IP + signedOffset) & 0xFFFF;
      return null;
    }

    // RET (C3, C2)
    if (opcode === 0xC3) {
      this.IP = this.readWord(this.SS, this.SP);
      this.SP = (this.SP + 2) & 0xFFFF;
      return null;
    }

    if (opcode === 0xC2) {
      const popBytes = this.readWord(this.CS, this.IP);
      this.IP = (this.IP + 2) & 0xFFFF;
      const retAddr = this.readWord(this.SS, this.SP);
      this.SP = (this.SP + 2 + popBytes) & 0xFFFF;
      this.IP = retAddr;
      return null;
    }

    // LOOP (E2)
    if (opcode === 0xE2) {
      const offset = this.readByte(this.CS, this.IP);
      this.IP = (this.IP + 1) & 0xFFFF;
      const signedOffset = offset > 127 ? offset - 256 : offset;
      
      this.CX = (this.CX - 1) & 0xFFFF;
      if (this.CX !== 0) {
        this.IP = (this.IP + signedOffset) & 0xFFFF;
      }
      return null;
    }

    // LOOPZ/LOOPE (E1)
    if (opcode === 0xE1) {
      const offset = this.readByte(this.CS, this.IP);
      this.IP = (this.IP + 1) & 0xFFFF;
      const signedOffset = offset > 127 ? offset - 256 : offset;
      
      this.CX = (this.CX - 1) & 0xFFFF;
      if (this.CX !== 0 && this.flags.ZF === 1) {
        this.IP = (this.IP + signedOffset) & 0xFFFF;
      }
      return null;
    }

    // LOOPNZ/LOOPNE (E0)
    if (opcode === 0xE0) {
      const offset = this.readByte(this.CS, this.IP);
      this.IP = (this.IP + 1) & 0xFFFF;
      const signedOffset = offset > 127 ? offset - 256 : offset;
      
      this.CX = (this.CX - 1) & 0xFFFF;
      if (this.CX !== 0 && this.flags.ZF === 0) {
        this.IP = (this.IP + signedOffset) & 0xFFFF;
      }
      return null;
    }

    // Flag manipulation
    if (opcode === 0xF8) { this.flags.CF = 0; return null; } // CLC
    if (opcode === 0xF9) { this.flags.CF = 1; return null; } // STC
    if (opcode === 0xF5) { this.flags.CF = this.flags.CF ^ 1; return null; } // CMC
    if (opcode === 0xFC) { this.flags.DF = 0; return null; } // CLD
    if (opcode === 0xFD) { this.flags.DF = 1; return null; } // STD
    if (opcode === 0xFA) { this.flags.IF = 0; return null; } // CLI
    if (opcode === 0xFB) { this.flags.IF = 1; return null; } // STI

    // INT
    if (opcode === 0xCD) {
      const intNum = this.readByte(this.CS, this.IP);
      this.IP = (this.IP + 1) & 0xFFFF;
      return this.interrupt(intNum);
    }
    
    // HLT
    if (opcode === 0xF4) {
      this.halted = true;
      return { type: 'halt' };
    }
    
    // NOP
    if (opcode === 0x90) {
      return null;
    }
    
    return null;
  }
}

// Complete 8086 Assembler
class Assembler {
  constructor() {
    this.labels = {};
    this.dataLabels = {};
  }

  assemble(code) {
    const lines = code.split('\n');
    const machineCode = [];
    this.labels = {};
    this.dataLabels = {};
    const addressToLine = {};
    const errors = [];

    let address = 0;

    // First pass: collect labels and data
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum].trim();
      if (!line || line.startsWith(';')) continue;
      
      const cleanLine = line.split(';')[0].trim();
      if (!cleanLine) continue;

      // Data definitions
      if (cleanLine.match(/^\w+:\s*DB\s+/i)) {
        const match = cleanLine.match(/^(\w+):\s*DB\s+"([^"]*)"/i);
        if (match) {
          const label = match[1].toUpperCase();
          const str = match[2];
          this.dataLabels[label] = { address, length: str.length, data: str };
          
          for (let i = 0; i < str.length; i++) {
            machineCode.push(str.charCodeAt(i));
          }
          address += str.length;
          continue;
        }
      }

      // Code labels
      const labelMatch = cleanLine.match(/^(\w+):/);
      if (labelMatch) {
        this.labels[labelMatch[1].toUpperCase()] = address;
        const afterLabel = cleanLine.substring(labelMatch[0].length).trim();
        if (!afterLabel) continue;
      }
      
      const instruction = cleanLine.replace(/^\w+:\s*/, '');
      if (!instruction) continue;
      
      addressToLine[address] = lineNum;
      address += this.estimateInstructionSize(instruction);
    }

    // Second pass: generate machine code
    address = 0;
    for (const dataLabel of Object.values(this.dataLabels)) {
      address += dataLabel.length;
    }

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum].trim();
      if (!line || line.startsWith(';')) continue;
      
      const cleanLine = line.split(';')[0].trim();
      if (!cleanLine) continue;

      if (cleanLine.match(/^\w+:\s*DB\s+/i)) continue;
      if (cleanLine.match(/^\w+:\s*$/) || cleanLine === cleanLine.match(/^\w+:/)?.[0]) continue;

      const instruction = cleanLine.replace(/^\w+:\s*/, '');
      if (!instruction) continue;

      try {
        const bytes = this.parseInstruction(instruction);
        if (bytes) {
          machineCode.push(...bytes);
        }
      } catch (e) {
        errors.push({ line: lineNum + 1, message: e.message });
      }
    }

    return { machineCode, errors, labels: this.labels, addressToLine };
  }

  estimateInstructionSize(instruction) {
    const upper = instruction.toUpperCase();
    const parts = upper.split(/[\s,]+/).filter(p => p);
    const op = parts[0];

    if (op === 'MOV') {
      if (upper.match(/[ABCD][XHL],\s*0X[0-9A-Fa-f]+/i)) return 3;
      if (upper.match(/[ABCD][XHL],\s*\d+/)) return 3;
      if (upper.match(/OFFSET/i)) return 3;
      return 2;
    }
    if (['ADD', 'SUB', 'ADC', 'SBB', 'CMP', 'AND', 'OR', 'XOR', 'TEST'].includes(op)) {
      if (upper.match(/AX,\s*0X[0-9A-Fa-f]+/i) || upper.match(/AX,\s*\d+/)) return 3;
      if (upper.match(/AL,\s*0X[0-9A-Fa-f]+/i) || upper.match(/AL,\s*\d+/)) return 2;
      return 2;
    }
    if (['JMP', 'JE', 'JNE', 'JZ', 'JNZ', 'JG', 'JL', 'JGE', 'JLE', 'JB', 'JA', 'JBE', 'JAE',
         'JC', 'JNC', 'JO', 'JNO', 'JS', 'JNS', 'JP', 'JNP', 'LOOP', 'LOOPE', 'LOOPZ', 'LOOPNE', 'LOOPNZ'].includes(op)) return 2;
    if (['CALL', 'RET'].includes(op)) return parts.length > 1 ? 3 : 1;
    if (['PUSH', 'POP', 'INC', 'DEC', 'NOT', 'NEG', 'MUL', 'DIV'].includes(op)) return parts.length > 1 ? 2 : 1;
    if (['SHL', 'SHR', 'SAL', 'SAR', 'ROL', 'ROR', 'RCL', 'RCR'].includes(op)) return 2;
    if (['INT'].includes(op)) return 2;
    if (['HLT', 'NOP', 'CLC', 'STC', 'CMC', 'CLD', 'STD', 'CLI', 'STI'].includes(op)) return 1;
    if (['XCHG'].includes(op)) return 1;
    return 1;
  }

  parseInstruction(instruction) {
    const parts = instruction.toUpperCase().split(/[\s,]+/).filter(p => p);
    const opcode = parts[0];

    const handlers = {
      'MOV': () => this.assembleMOV(parts.slice(1)),
      'ADD': () => this.assembleADD(parts.slice(1)),
      'ADC': () => this.assembleADC(parts.slice(1)),
      'SUB': () => this.assembleSUB(parts.slice(1)),
      'SBB': () => this.assembleSBB(parts.slice(1)),
      'CMP': () => this.assembleCMP(parts.slice(1)),
      'AND': () => this.assembleAND(parts.slice(1)),
      'OR': () => this.assembleOR(parts.slice(1)),
      'XOR': () => this.assembleXOR(parts.slice(1)),
      'TEST': () => this.assembleTEST(parts.slice(1)),
      'NOT': () => this.assembleNOT(parts.slice(1)),
      'NEG': () => this.assembleNEG(parts.slice(1)),
      'MUL': () => this.assembleMUL(parts.slice(1)),
      'DIV': () => this.assembleDIV(parts.slice(1)),
      'INC': () => this.assembleINC(parts.slice(1)),
      'DEC': () => this.assembleDEC(parts.slice(1)),
      'SHL': () => this.assembleSHL(parts.slice(1)),
      'SAL': () => this.assembleSHL(parts.slice(1)),
      'SHR': () => this.assembleSHR(parts.slice(1)),
      'SAR': () => this.assembleSAR(parts.slice(1)),
      'ROL': () => this.assembleROL(parts.slice(1)),
      'ROR': () => this.assembleROR(parts.slice(1)),
      'PUSH': () => this.assemblePUSH(parts.slice(1)),
      'POP': () => this.assemblePOP(parts.slice(1)),
      'XCHG': () => this.assembleXCHG(parts.slice(1)),
      'JMP': () => this.assembleJMP(parts.slice(1)),
      'JE': () => this.assembleJE(parts.slice(1)),
      'JZ': () => this.assembleJE(parts.slice(1)),
      'JNE': () => this.assembleJNE(parts.slice(1)),
      'JNZ': () => this.assembleJNE(parts.slice(1)),
      'JG': () => this.assembleJG(parts.slice(1)),
      'JL': () => this.assembleJL(parts.slice(1)),
      'JGE': () => this.assembleJGE(parts.slice(1)),
      'JLE': () => this.assembleJLE(parts.slice(1)),
      'JA': () => this.assembleJA(parts.slice(1)),
      'JB': () => this.assembleJB(parts.slice(1)),
      'JAE': () => this.assembleJAE(parts.slice(1)),
      'JBE': () => this.assembleJBE(parts.slice(1)),
      'JC': () => this.assembleJC(parts.slice(1)),
      'JNC': () => this.assembleJNC(parts.slice(1)),
      'JO': () => this.assembleJO(parts.slice(1)),
      'JNO': () => this.assembleJNO(parts.slice(1)),
      'JS': () => this.assembleJS(parts.slice(1)),
      'JNS': () => this.assembleJNS(parts.slice(1)),
      'JP': () => this.assembleJP(parts.slice(1)),
      'JPE': () => this.assembleJP(parts.slice(1)),
      'JNP': () => this.assembleJNP(parts.slice(1)),
      'JPO': () => this.assembleJNP(parts.slice(1)),
      'LOOP': () => this.assembleLOOP(parts.slice(1)),
      'LOOPE': () => this.assembleLOOPE(parts.slice(1)),
      'LOOPZ': () => this.assembleLOOPE(parts.slice(1)),
      'LOOPNE': () => this.assembleLOOPNE(parts.slice(1)),
      'LOOPNZ': () => this.assembleLOOPNE(parts.slice(1)),
      'CALL': () => this.assembleCALL(parts.slice(1)),
      'RET': () => this.assembleRET(parts.slice(1)),
      'INT': () => [0xCD, this.parseNumber(parts[1])],
      'HLT': () => [0xF4],
      'NOP': () => [0x90],
      'CLC': () => [0xF8],
      'STC': () => [0xF9],
      'CMC': () => [0xF5],
      'CLD': () => [0xFC],
      'STD': () => [0xFD],
      'CLI': () => [0xFA],
      'STI': () => [0xFB],
    };

    if (handlers[opcode]) {
      return handlers[opcode]();
    }

    throw new Error(`Unknown instruction: ${opcode}`);
  }

  // Register maps
  get regMap16() { return { AX: 0, CX: 1, DX: 2, BX: 3, SP: 4, BP: 5, SI: 6, DI: 7 }; }
  get regMap8() { return { AL: 0, CL: 1, DL: 2, BL: 3, AH: 4, CH: 5, DH: 6, BH: 7 }; }
  get segMap() { return { ES: 0, CS: 1, SS: 2, DS: 3 }; }

  assembleMOV(args) {
    const [dest, src] = args;

    // MOV segment, reg
    if (this.segMap[dest] !== undefined && this.regMap16[src] !== undefined) {
      return [0x8E, 0xC0 + (this.segMap[dest] << 3) + this.regMap16[src]];
    }

    // MOV reg, segment
    if (this.regMap16[dest] !== undefined && this.segMap[src] !== undefined) {
      return [0x8C, 0xC0 + (this.segMap[src] << 3) + this.regMap16[dest]];
    }

    // MOV reg16, imm16
    if (this.regMap16[dest] !== undefined && (src.startsWith('0X') || /^\d+$/.test(src))) {
      const value = this.parseNumber(src);
      return [0xB8 + this.regMap16[dest], value & 0xFF, (value >> 8) & 0xFF];
    }

    // MOV reg8, imm8
    if (this.regMap8[dest] !== undefined && (src.startsWith('0X') || /^\d+$/.test(src))) {
      const value = this.parseNumber(src);
      return [0xB0 + this.regMap8[dest], value & 0xFF];
    }

    // MOV reg, reg (16-bit)
    if (this.regMap16[dest] !== undefined && this.regMap16[src] !== undefined) {
      return [0x89, 0xC0 + (this.regMap16[src] << 3) + this.regMap16[dest]];
    }

    // MOV reg, reg (8-bit)
    if (this.regMap8[dest] !== undefined && this.regMap8[src] !== undefined) {
      return [0x88, 0xC0 + (this.regMap8[src] << 3) + this.regMap8[dest]];
    }

    // MOV reg, OFFSET label
    if (this.regMap16[dest] !== undefined && src.startsWith('OFFSET')) {
      const labelName = src.substring(6).trim();
      const labelAddr = this.labels[labelName] || this.dataLabels[labelName]?.address || 0;
      return [0xB8 + this.regMap16[dest], labelAddr & 0xFF, (labelAddr >> 8) & 0xFF];
    }

    throw new Error(`Cannot assemble MOV ${dest}, ${src}`);
  }

  assembleADD(args) {
    const [dest, src] = args;
    
    if (dest === 'AX' && (src.startsWith('0X') || /^\d+$/.test(src))) {
      const value = this.parseNumber(src);
      return [0x05, value & 0xFF, (value >> 8) & 0xFF];
    }

    if (dest === 'AL' && (src.startsWith('0X') || /^\d+$/.test(src))) {
      const value = this.parseNumber(src);
      return [0x04, value & 0xFF];
    }

    if (this.regMap16[dest] !== undefined && this.regMap16[src] !== undefined) {
      return [0x01, 0xC0 + (this.regMap16[src] << 3) + this.regMap16[dest]];
    }

    throw new Error(`Cannot assemble ADD ${dest}, ${src}`);
  }

  assembleADC(args) {
    const [dest, src] = args;
    
    if (dest === 'AX' && (src.startsWith('0X') || /^\d+$/.test(src))) {
      const value = this.parseNumber(src);
      return [0x15, value & 0xFF, (value >> 8) & 0xFF];
    }

    if (this.regMap16[dest] !== undefined && this.regMap16[src] !== undefined) {
      return [0x11, 0xC0 + (this.regMap16[src] << 3) + this.regMap16[dest]];
    }

    throw new Error(`Cannot assemble ADC ${dest}, ${src}`);
  }

  assembleSUB(args) {
    const [dest, src] = args;
    
    if (dest === 'AX' && (src.startsWith('0X') || /^\d+$/.test(src))) {
      const value = this.parseNumber(src);
      return [0x2D, value & 0xFF, (value >> 8) & 0xFF];
    }

    if (dest === 'AL' && (src.startsWith('0X') || /^\d+$/.test(src))) {
      const value = this.parseNumber(src);
      return [0x2C, value & 0xFF];
    }

    if (this.regMap16[dest] !== undefined && this.regMap16[src] !== undefined) {
      return [0x29, 0xC0 + (this.regMap16[src] << 3) + this.regMap16[dest]];
    }

    throw new Error(`Cannot assemble SUB ${dest}, ${src}`);
  }

  assembleSBB(args) {
    const [dest, src] = args;
    
    if (dest === 'AX' && (src.startsWith('0X') || /^\d+$/.test(src))) {
      const value = this.parseNumber(src);
      return [0x1D, value & 0xFF, (value >> 8) & 0xFF];
    }

    if (this.regMap16[dest] !== undefined && this.regMap16[src] !== undefined) {
      return [0x19, 0xC0 + (this.regMap16[src] << 3) + this.regMap16[dest]];
    }

    throw new Error(`Cannot assemble SBB ${dest}, ${src}`);
  }

  assembleCMP(args) {
    const [dest, src] = args;
    
    if (dest === 'AX' && (src.startsWith('0X') || /^\d+$/.test(src))) {
      const value = this.parseNumber(src);
      return [0x3D, value & 0xFF, (value >> 8) & 0xFF];
    }

    if (dest === 'AL' && (src.startsWith('0X') || /^\d+$/.test(src))) {
      const value = this.parseNumber(src);
      return [0x3C, value & 0xFF];
    }

    if (this.regMap16[dest] !== undefined && this.regMap16[src] !== undefined) {
      return [0x39, 0xC0 + (this.regMap16[src] << 3) + this.regMap16[dest]];
    }

    throw new Error(`Cannot assemble CMP ${dest}, ${src}`);
  }

  assembleAND(args) {
    const [dest, src] = args;
    
    if (dest === 'AX' && (src.startsWith('0X') || /^\d+$/.test(src))) {
      const value = this.parseNumber(src);
      return [0x25, value & 0xFF, (value >> 8) & 0xFF];
    }

    if (this.regMap16[dest] !== undefined && this.regMap16[src] !== undefined) {
      return [0x21, 0xC0 + (this.regMap16[src] << 3) + this.regMap16[dest]];
    }

    throw new Error(`Cannot assemble AND ${dest}, ${src}`);
  }

  assembleOR(args) {
    const [dest, src] = args;
    
    if (dest === 'AX' && (src.startsWith('0X') || /^\d+$/.test(src))) {
      const value = this.parseNumber(src);
      return [0x0D, value & 0xFF, (value >> 8) & 0xFF];
    }

    if (this.regMap16[dest] !== undefined && this.regMap16[src] !== undefined) {
      return [0x09, 0xC0 + (this.regMap16[src] << 3) + this.regMap16[dest]];
    }

    throw new Error(`Cannot assemble OR ${dest}, ${src}`);
  }

  assembleXOR(args) {
    const [dest, src] = args;
    
    if (dest === 'AX' && (src.startsWith('0X') || /^\d+$/.test(src))) {
      const value = this.parseNumber(src);
      return [0x35, value & 0xFF, (value >> 8) & 0xFF];
    }

    if (this.regMap16[dest] !== undefined && this.regMap16[src] !== undefined) {
      return [0x31, 0xC0 + (this.regMap16[src] << 3) + this.regMap16[dest]];
    }

    throw new Error(`Cannot assemble XOR ${dest}, ${src}`);
  }

  assembleTEST(args) {
    const [dest, src] = args;
    
    if (dest === 'AX' && (src.startsWith('0X') || /^\d+$/.test(src))) {
      const value = this.parseNumber(src);
      return [0xA9, value & 0xFF, (value >> 8) & 0xFF];
    }

    if (this.regMap16[dest] !== undefined && this.regMap16[src] !== undefined) {
      return [0x85, 0xC0 + (this.regMap16[src] << 3) + this.regMap16[dest]];
    }

    throw new Error(`Cannot assemble TEST ${dest}, ${src}`);
  }

  assembleNOT(args) {
    const reg = args[0];
    if (this.regMap16[reg] !== undefined) {
      return [0xF7, 0xD0 + this.regMap16[reg]];
    }
    throw new Error(`Cannot assemble NOT ${reg}`);
  }

  assembleNEG(args) {
    const reg = args[0];
    if (this.regMap16[reg] !== undefined) {
      return [0xF7, 0xD8 + this.regMap16[reg]];
    }
    throw new Error(`Cannot assemble NEG ${reg}`);
  }

  assembleMUL(args) {
    const reg = args[0];
    if (this.regMap16[reg] !== undefined) {
      return [0xF7, 0xE0 + this.regMap16[reg]];
    }
    throw new Error(`Cannot assemble MUL ${reg}`);
  }

  assembleDIV(args) {
    const reg = args[0];
    if (this.regMap16[reg] !== undefined) {
      return [0xF7, 0xF0 + this.regMap16[reg]];
    }
    throw new Error(`Cannot assemble DIV ${reg}`);
  }

  assembleINC(args) {
    const reg = args[0];
    if (this.regMap16[reg] !== undefined) {
      return [0x40 + this.regMap16[reg]];
    }
    throw new Error(`Cannot assemble INC ${reg}`);
  }

  assembleDEC(args) {
    const reg = args[0];
    if (this.regMap16[reg] !== undefined) {
      return [0x48 + this.regMap16[reg]];
    }
    throw new Error(`Cannot assemble DEC ${reg}`);
  }

  assembleSHL(args) {
    const reg = args[0];
    const count = args[1] || '1';
    if (this.regMap16[reg] !== undefined) {
      if (count === '1') {
        return [0xD1, 0xE0 + this.regMap16[reg]];
      } else if (count === 'CL') {
        return [0xD3, 0xE0 + this.regMap16[reg]];
      }
    }
    throw new Error(`Cannot assemble SHL ${reg}, ${count}`);
  }

  assembleSHR(args) {
    const reg = args[0];
    const count = args[1] || '1';
    if (this.regMap16[reg] !== undefined) {
      if (count === '1') {
        return [0xD1, 0xE8 + this.regMap16[reg]];
      } else if (count === 'CL') {
        return [0xD3, 0xE8 + this.regMap16[reg]];
      }
    }
    throw new Error(`Cannot assemble SHR ${reg}, ${count}`);
  }

  assembleSAR(args) {
    const reg = args[0];
    const count = args[1] || '1';
    if (this.regMap16[reg] !== undefined) {
      if (count === '1') {
        return [0xD1, 0xF8 + this.regMap16[reg]];
      } else if (count === 'CL') {
        return [0xD3, 0xF8 + this.regMap16[reg]];
      }
    }
    throw new Error(`Cannot assemble SAR ${reg}, ${count}`);
  }

  assembleROL(args) {
    const reg = args[0];
    const count = args[1] || '1';
    if (this.regMap16[reg] !== undefined) {
      if (count === '1') {
        return [0xD1, 0xC0 + this.regMap16[reg]];
      } else if (count === 'CL') {
        return [0xD3, 0xC0 + this.regMap16[reg]];
      }
    }
    throw new Error(`Cannot assemble ROL ${reg}, ${count}`);
  }

  assembleROR(args) {
    const reg = args[0];
    const count = args[1] || '1';
    if (this.regMap16[reg] !== undefined) {
      if (count === '1') {
        return [0xD1, 0xC8 + this.regMap16[reg]];
      } else if (count === 'CL') {
        return [0xD3, 0xC8 + this.regMap16[reg]];
      }
    }
    throw new Error(`Cannot assemble ROR ${reg}, ${count}`);
  }

  assemblePUSH(args) {
    const reg = args[0];
    if (this.regMap16[reg] !== undefined) {
      return [0x50 + this.regMap16[reg]];
    }
    throw new Error(`Cannot assemble PUSH ${reg}`);
  }

  assemblePOP(args) {
    const reg = args[0];
    if (this.regMap16[reg] !== undefined) {
      return [0x58 + this.regMap16[reg]];
    }
    throw new Error(`Cannot assemble POP ${reg}`);
  }

  assembleXCHG(args) {
    const [reg1, reg2] = args;
    if (reg1 === 'AX' && this.regMap16[reg2] !== undefined) {
      return [0x90 + this.regMap16[reg2]];
    }
    if (reg2 === 'AX' && this.regMap16[reg1] !== undefined) {
      return [0x90 + this.regMap16[reg1]];
    }
    throw new Error(`Cannot assemble XCHG ${reg1}, ${reg2}`);
  }

  assembleJMP(args) {
    const target = args[0];
    const addr = this.labels[target] || 0;
    return [0xEB, addr & 0xFF];
  }

  assembleJE(args) { return [0x74, (this.labels[args[0]] || 0) & 0xFF]; }
  assembleJNE(args) { return [0x75, (this.labels[args[0]] || 0) & 0xFF]; }
  assembleJG(args) { return [0x7F, (this.labels[args[0]] || 0) & 0xFF]; }
  assembleJL(args) { return [0x7C, (this.labels[args[0]] || 0) & 0xFF]; }
  assembleJGE(args) { return [0x7D, (this.labels[args[0]] || 0) & 0xFF]; }
  assembleJLE(args) { return [0x7E, (this.labels[args[0]] || 0) & 0xFF]; }
  assembleJA(args) { return [0x77, (this.labels[args[0]] || 0) & 0xFF]; }
  assembleJB(args) { return [0x72, (this.labels[args[0]] || 0) & 0xFF]; }
  assembleJAE(args) { return [0x73, (this.labels[args[0]] || 0) & 0xFF]; }
  assembleJBE(args) { return [0x76, (this.labels[args[0]] || 0) & 0xFF]; }
  assembleJC(args) { return [0x72, (this.labels[args[0]] || 0) & 0xFF]; }
  assembleJNC(args) { return [0x73, (this.labels[args[0]] || 0) & 0xFF]; }
  assembleJO(args) { return [0x70, (this.labels[args[0]] || 0) & 0xFF]; }
  assembleJNO(args) { return [0x71, (this.labels[args[0]] || 0) & 0xFF]; }
  assembleJS(args) { return [0x78, (this.labels[args[0]] || 0) & 0xFF]; }
  assembleJNS(args) { return [0x79, (this.labels[args[0]] || 0) & 0xFF]; }
  assembleJP(args) { return [0x7A, (this.labels[args[0]] || 0) & 0xFF]; }
  assembleJNP(args) { return [0x7B, (this.labels[args[0]] || 0) & 0xFF]; }
  assembleLOOP(args) { return [0xE2, (this.labels[args[0]] || 0) & 0xFF]; }
  assembleLOOPE(args) { return [0xE1, (this.labels[args[0]] || 0) & 0xFF]; }
  assembleLOOPNE(args) { return [0xE0, (this.labels[args[0]] || 0) & 0xFF]; }

  assembleCALL(args) {
    const target = args[0];
    const addr = this.labels[target] || 0;
    return [0xE8, addr & 0xFF, (addr >> 8) & 0xFF];
  }

  assembleRET(args) {
    if (args.length === 0) {
      return [0xC3];
    } else {
      const popBytes = this.parseNumber(args[0]);
      return [0xC2, popBytes & 0xFF, (popBytes >> 8) & 0xFF];
    }
  }

  parseNumber(str) {
    if (str.startsWith('0X')) {
      return parseInt(str.substring(2), 16);
    }
    return parseInt(str, 10);
  }
}

// Main React Component
export default function Emulator8086() {
  const [code, setCode] = useState(`; 8086 Assembly Program
; Hello World using BIOS interrupts

hello: DB "Hello, 8086 World!"

start:
  MOV AH, 0x13         ; BIOS Write String function
  MOV CX, 18           ; String length
  MOV BX, 0            ; Page 0
  MOV ES, BX           ; ES = 0
  MOV BP, OFFSET hello ; String offset
  MOV DL, 0            ; Column 0
  INT 0x10             ; Call BIOS
  HLT                  ; Halt execution`);
  
  const [cpu, setCpu] = useState(() => new CPU8086());
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);
  const [compiled, setCompiled] = useState(false);
  const [errors, setErrors] = useState([]);
  const [darkMode, setDarkMode] = useState(true);
  const [memoryStart, setMemoryStart] = useState('00000');
  const [currentLine, setCurrentLine] = useState(-1);
  const [addressToLine, setAddressToLine] = useState({});
  const [executionSpeed, setExecutionSpeed] = useState(500);
  
  const runIntervalRef = useRef(null);

  const compile = () => {
    stopProgram();
    
    const assembler = new Assembler();
    const result = assembler.assemble(code);
    
    if (result.errors.length > 0) {
      setErrors(result.errors);
      setCompiled(false);
      return;
    }

    const newCpu = new CPU8086();
    result.machineCode.forEach((byte, index) => {
      newCpu.memory[index] = byte;
    });
    
    setCpu(newCpu);
    setAddressToLine(result.addressToLine || {});
    setCurrentLine(result.addressToLine[0] !== undefined ? result.addressToLine[0] : -1);
    setCompiled(true);
    setErrors([]);
    setOutput('');
  };

  const runProgram = () => {
    if (!compiled) {
      compile();
      setTimeout(() => {
        setRunning(true);
        startExecution();
      }, 100);
      return;
    }
    setRunning(true);
    startExecution();
  };

  const startExecution = () => {
    runIntervalRef.current = setInterval(() => {
      setCpu(currentCpu => {
        if (currentCpu.halted) {
          setTimeout(() => {
            stopProgram();
            setCurrentLine(-1);
          }, 0);
          return currentCpu;
        }

        const currentIP = currentCpu.IP;
        const lineNum = addressToLine[currentIP];
        
        if (lineNum !== undefined) {
          setCurrentLine(lineNum);
        }
        
        const result = currentCpu.step();
        
        if (result) {
          if (result.type === 'output') {
            setOutput(prev => prev + result.data);
          } else if (result.type === 'halt') {
            setTimeout(() => {
              stopProgram();
              setCurrentLine(-1);
            }, 0);
          } else if (result.type === 'error') {
            setErrors([{ line: 0, message: result.message }]);
            setTimeout(() => stopProgram(), 0);
          }
        }
        
        if (currentCpu.halted) {
          setTimeout(() => {
            stopProgram();
            setCurrentLine(-1);
          }, 0);
        }
        
        const newCpu = new CPU8086();
        Object.assign(newCpu, currentCpu);
        return newCpu;
      });
    }, executionSpeed);
  };

  const stopProgram = () => {
    setRunning(false);
    if (runIntervalRef.current) {
      clearInterval(runIntervalRef.current);
      runIntervalRef.current = null;
    }
  };

  const step = () => {
    if (!compiled) {
      compile();
      setTimeout(() => {
        step();
      }, 100);
      return;
    }
    
    const currentIP = cpu.IP;
    const lineNum = addressToLine[currentIP];
    
    if (lineNum !== undefined) {
      setCurrentLine(lineNum);
    }
    
    setTimeout(() => {
      if (cpu.halted) {
        setCurrentLine(-1);
        return;
      }
      
      const result = cpu.step();
      
      if (result && result.type === 'output') {
        setOutput(prev => prev + result.data);
      }
      
      if (result && result.type === 'error') {
        setErrors([{ line: 0, message: result.message }]);
      }
      
      if (cpu.halted) {
        setCurrentLine(-1);
      }
      
      const newCpu = new CPU8086();
      Object.assign(newCpu, cpu);
      setCpu(newCpu);
    }, 50);
  };

  const reset = () => {
    stopProgram();
    const newCpu = new CPU8086();
    setCpu(newCpu);
    setOutput('');
    setCompiled(false);
    setCurrentLine(-1);
    setAddressToLine({});
    setErrors([]);
  };

  useEffect(() => {
    return () => {
      if (runIntervalRef.current) {
        clearInterval(runIntervalRef.current);
      }
    };
  }, []);

  const formatHex = (val, digits = 4) => {
    return val.toString(16).toUpperCase().padStart(digits, '0');
  };

  const getMemoryView = () => {
    const start = parseInt(memoryStart, 16) || 0;
    const rows = [];
    for (let i = 0; i < 16; i++) {
      const addr = start + (i * 16);
      const bytes = [];
      for (let j = 0; j < 16; j++) {
        bytes.push(formatHex(cpu.memory[addr + j] || 0, 2));
      }
      rows.push({ addr: formatHex(addr, 5), bytes });
    }
    return rows;
  };

  return (
    <div className={`min-h-screen ${darkMode ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-900'}`}>
      {/* Header */}
      <div className={`${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} border-b px-6 py-4`}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-blue-500">Intel 8086 Emulator</h1>
            <p className="text-sm text-gray-500">Complete 16-bit Microprocessor Simulator</p>
          </div>
          <div className="flex gap-2">
            <button 
              onClick={() => setDarkMode(!darkMode)}
              className={`p-2 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}
              title="Toggle theme"
            >
              {darkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            <button 
              className={`p-2 rounded ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}
              title="Information"
            >
              <Info size={20} />
            </button>
          </div>
        </div>
      </div>

      <div className="flex gap-4 p-4">
        {/* Code Editor Section */}
        <div className={`flex-1 ${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-lg shadow-lg p-4`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Assembly Code Editor</h2>
            <div className="flex gap-2 items-center">
              <div className="flex items-center gap-2 mr-4">
                <label className="text-sm">Speed (ms):</label>
                <input
                  type="number"
                  value={executionSpeed}
                  onChange={(e) => setExecutionSpeed(Math.max(50, parseInt(e.target.value) || 500))}
                  className={`w-20 px-2 py-1 text-sm rounded ${darkMode ? 'bg-gray-900 border-gray-700' : 'bg-gray-100 border-gray-300'} border`}
                  min="50"
                  step="50"
                />
              </div>
              <button
                onClick={compile}
                className="px-4 py-2 bg-blue-600 text-white rounded font-semibold hover:bg-blue-700 transition"
                title="Compile assembly code"
              >
                COMPILE
              </button>
              <button
                onClick={running ? stopProgram : runProgram}
                className={`px-4 py-2 rounded font-semibold transition ${
                  running 
                    ? 'bg-red-600 hover:bg-red-700 text-white' 
                    : 'bg-green-600 hover:bg-green-700 text-white'
                }`}
                disabled={!compiled && !running}
                title={running ? 'Stop execution' : 'Run program'}
              >
                {running ? <><Square size={16} className="inline mr-1" />STOP</> : <><Play size={16} className="inline mr-1" />RUN</>}
              </button>
              <button
                onClick={step}
                className="px-4 py-2 bg-yellow-600 text-white rounded font-semibold hover:bg-yellow-700 transition"
                disabled={running}
                title="Execute one instruction"
              >
                <SkipForward size={16} className="inline mr-1" />STEP
              </button>
              <button
                onClick={reset}
                className={`px-4 py-2 rounded font-semibold transition ${
                  darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-300 hover:bg-gray-400'
                }`}
                title="Reset CPU and clear output"
              >
                <RotateCcw size={16} className="inline mr-1" />RESET
              </button>
            </div>
          </div>
          
          {!compiled ? (
            <textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={`w-full h-[500px] font-mono text-sm p-4 rounded ${
                darkMode ? 'bg-gray-900 text-green-400 border-gray-700' : 'bg-gray-50 text-gray-900 border-gray-300'
              } border focus:outline-none focus:ring-2 focus:ring-blue-500`}
              spellCheck={false}
              placeholder="Enter 8086 assembly code here..."
            />
          ) : (
            <div className={`w-full h-[500px] font-mono text-sm p-4 rounded overflow-auto ${
              darkMode ? 'bg-gray-900 border-gray-700' : 'bg-gray-50 border-gray-300'
            } border`}>
              {code.split('\n').map((line, index) => (
                <div
                  key={index}
                  className={`px-2 py-1 transition-colors duration-150 ${
                    currentLine === index
                      ? 'bg-yellow-500 text-black font-bold'
                      : darkMode
                      ? 'text-green-400'
                      : 'text-gray-900'
                  }`}
                >
                  <span className={`inline-block w-10 text-right mr-4 select-none ${
                    currentLine === index 
                      ? 'text-gray-800 font-bold' 
                      : darkMode 
                      ? 'text-gray-600' 
                      : 'text-gray-400'
                  }`}>
                    {index + 1}
                  </span>
                  <span>{line || ' '}</span>
                </div>
              ))}
            </div>
          )}
          
          {errors.length > 0 && (
            <div className="mt-4 p-4 bg-red-900 text-red-200 rounded border border-red-700">
              <h3 className="font-bold mb-2">Compilation Errors:</h3>
              {errors.map((err, i) => (
                <div key={i} className="text-sm">Line {err.line}: {err.message}</div>
              ))}
            </div>
          )}
        </div>

        {/* Right Panel - Registers and Status */}
        <div className="w-96 space-y-4">
          {/* General Purpose Registers */}
          <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-lg shadow-lg p-4`}>
            <h3 className="text-sm font-bold mb-3 pb-2 border-b border-blue-500">General Purpose Registers</h3>
            <div className="space-y-2">
              <div className="grid grid-cols-4 gap-2 text-xs font-semibold mb-2">
                <div>Reg</div>
                <div>16-bit</div>
                <div>High</div>
                <div>Low</div>
              </div>
              {[
                ['AX', formatHex(cpu.AX), formatHex(cpu.AX >> 8, 2), formatHex(cpu.AX & 0xFF, 2)],
                ['BX', formatHex(cpu.BX), formatHex(cpu.BX >> 8, 2), formatHex(cpu.BX & 0xFF, 2)],
                ['CX', formatHex(cpu.CX), formatHex(cpu.CX >> 8, 2), formatHex(cpu.CX & 0xFF, 2)],
                ['DX', formatHex(cpu.DX), formatHex(cpu.DX >> 8, 2), formatHex(cpu.DX & 0xFF, 2)]
              ].map(([reg, full, h, l]) => (
                <div key={reg} className="grid grid-cols-4 gap-2 text-sm font-mono">
                  <div className="font-semibold text-blue-400">{reg}</div>
                  <div>{full}</div>
                  <div>{h}</div>
                  <div>{l}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Segment and Pointer Registers */}
          <div className="grid grid-cols-2 gap-4">
            <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-lg shadow-lg p-4`}>
              <h3 className="text-xs font-bold mb-2 pb-2 border-b border-blue-500">Segment Registers</h3>
              {[
                ['CS', formatHex(cpu.CS)],
                ['DS', formatHex(cpu.DS)],
                ['SS', formatHex(cpu.SS)],
                ['ES', formatHex(cpu.ES)]
              ].map(([seg, val]) => (
                <div key={seg} className="flex justify-between text-sm py-1 font-mono">
                  <span className="font-semibold text-blue-400">{seg}</span>
                  <span>{val}</span>
                </div>
              ))}
            </div>
            
            <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-lg shadow-lg p-4`}>
              <h3 className="text-xs font-bold mb-2 pb-2 border-b border-blue-500">Pointer/Index Registers</h3>
              {[
                ['IP', formatHex(cpu.IP)],
                ['SP', formatHex(cpu.SP)],
                ['BP', formatHex(cpu.BP)],
                ['SI', formatHex(cpu.SI)],
                ['DI', formatHex(cpu.DI)]
              ].map(([ptr, val]) => (
                <div key={ptr} className="flex justify-between text-sm py-1 font-mono">
                  <span className="font-semibold text-blue-400">{ptr}</span>
                  <span>{val}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Flags Register */}
          <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-lg shadow-lg p-4`}>
            <h3 className="text-sm font-bold mb-2 pb-2 border-b border-blue-500">FLAGS Register</h3>
            <div className="grid grid-cols-3 gap-2 text-xs">
              {Object.entries(cpu.flags).map(([flag, val]) => (
                <div key={flag} className="text-center p-2 rounded bg-gray-700">
                  <div className="font-semibold text-gray-300">{flag}</div>
                  <div className={`font-mono text-lg font-bold ${val === 1 ? 'text-green-400' : 'text-gray-500'}`}>
                    {val}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Memory Viewer */}
          <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-lg shadow-lg p-4`}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold">Memory Viewer</h3>
              <div className="flex items-center gap-2">
                <span className="text-xs">Address:</span>
                <input
                  type="text"
                  value={memoryStart}
                  onChange={(e) => setMemoryStart(e.target.value.toUpperCase())}
                  className={`w-24 px-2 py-1 text-xs font-mono rounded ${
                    darkMode ? 'bg-gray-900 border-gray-700' : 'bg-gray-100 border-gray-300'
                  } border`}
                  placeholder="00000"
                  maxLength={5}
                />
              </div>
            </div>
            <div className="font-mono text-xs space-y-1 max-h-64 overflow-y-auto">
              <div className="flex gap-1 text-gray-500 sticky top-0 bg-gray-800 pb-1">
                <span className="w-16">Addr</span>
                {[...Array(16)].map((_, i) => (
                  <span key={i} className="w-6 text-center">{formatHex(i, 2)}</span>
                ))}
              </div>
              {getMemoryView().map(row => (
                <div key={row.addr} className="flex gap-1">
                  <span className="text-yellow-500 w-16">{row.addr}</span>
                  {row.bytes.map((byte, i) => (
                    <span 
                      key={i} 
                      className={`w-6 text-center ${byte !== '00' ? 'text-green-400 font-semibold' : 'text-gray-600'}`}
                    >
                      {byte}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Output Console */}
      <div className={`mx-4 mb-4 ${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-lg shadow-lg p-4`}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">Program Output</h3>
          <button
            onClick={() => setOutput('')}
            className="text-xs px-3 py-1 bg-gray-700 rounded hover:bg-gray-600"
          >
            Clear
          </button>
        </div>
        <div className={`font-mono text-sm p-4 rounded min-h-24 max-h-48 overflow-y-auto ${
          darkMode ? 'bg-gray-900 border-gray-700' : 'bg-gray-50 border-gray-300'
        } border`}>
          {output ? (
            <pre className="whitespace-pre-wrap">{output}</pre>
          ) : (
            <span className="text-gray-500 italic">Program output will appear here...</span>
          )}
        </div>
      </div>

      {/* Status Bar */}
      <div className={`mx-4 mb-4 px-4 py-2 ${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-lg shadow-lg`}>
        <div className="flex items-center justify-between text-sm">
          <div className="flex gap-6">
            <div>
              <span className="text-gray-500">Status: </span>
              <span className={`font-semibold ${
                running ? 'text-green-400' : 
                cpu.halted ? 'text-red-400' : 
                compiled ? 'text-yellow-400' : 'text-gray-400'
              }`}>
                {running ? 'RUNNING' : cpu.halted ? 'HALTED' : compiled ? 'READY' : 'NOT COMPILED'}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Physical Address: </span>
              <span className="font-mono text-blue-400">
                {formatHex(((cpu.CS << 4) + cpu.IP) & 0xFFFFF, 5)}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Stack Top: </span>
              <span className="font-mono text-blue-400">
                {formatHex(((cpu.SS << 4) + cpu.SP) & 0xFFFFF, 5)}
              </span>
            </div>
          </div>
          <div className="text-xs text-gray-500">
            Intel 8086 - 16-bit Microprocessor Emulator
          </div>
        </div>
      </div>
    </div>
  );
}






