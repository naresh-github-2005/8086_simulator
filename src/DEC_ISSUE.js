import React, { useState, useRef, useEffect } from 'react';
import { Play, Square, SkipForward, RotateCcw, Sun, Moon, Info } from 'lucide-react';

// Complete 8086 CPU Emulator with Proper Loop Handling
class CPU8086 {
  constructor() {
    this.reset();
  }

  reset() {
    this.AX = 0; this.BX = 0; this.CX = 0; this.DX = 0;
    this.SI = 0; this.DI = 0; this.BP = 0; this.SP = 0xFFFE;
    this.IP = 0;
    this.CS = 0; this.DS = 0; this.ES = 0; this.SS = 0;
    this.flags = { CF: 0, PF: 0, AF: 0, ZF: 0, SF: 0, TF: 0, IF: 1, DF: 0, OF: 0 };
    this.memory = new Uint8Array(0x100000);
    this.halted = false;
  }

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

  updateFlags(result, size = 16, op = null, operand1 = 0, operand2 = 0) {
    const mask = size === 8 ? 0xFF : 0xFFFF;
    const signBit = size === 8 ? 0x80 : 0x8000;
    
    result = result & mask;
    
    this.flags.ZF = result === 0 ? 1 : 0;
    this.flags.SF = (result & signBit) ? 1 : 0;
    
    let parity = 0;
    let temp = result & 0xFF;
    for (let i = 0; i < 8; i++) {
      if (temp & 1) parity++;
      temp >>= 1;
    }
    this.flags.PF = (parity % 2) === 0 ? 1 : 0;
    
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
    } else if (op === 'mul') {
      // MUL sets CF and OF if upper half is non-zero
      const upperHalf = size === 8 ? this.getAH() : this.DX;
      this.flags.CF = upperHalf !== 0 ? 1 : 0;
      this.flags.OF = this.flags.CF;
    } else if (op === 'and' || op === 'or' || op === 'xor' || op === 'test') {
      this.flags.CF = 0;
      this.flags.OF = 0;
    } else if (op === 'inc') {
      const sign1 = operand1 & signBit;
      const signRes = result & signBit;
      this.flags.OF = (operand1 === (mask ^ signBit)) ? 1 : 0;
      this.flags.AF = ((operand1 & 0x0F) + 1) > 0x0F ? 1 : 0;
    } else if (op === 'dec') {
      const sign1 = operand1 & signBit;
      const signRes = result & signBit;
      this.flags.OF = (operand1 === signBit) ? 1 : 0;
      this.flags.AF = ((operand1 & 0x0F) - 1) < 0 ? 1 : 0;
    }
  }

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

  interrupt(intNum) {
    if (intNum === 0x10) return this.handleVideoInterrupt();
    if (intNum === 0x21) return this.handleDOSInterrupt();
    return null;
  }

  handleVideoInterrupt() {
    const ah = this.getAH();
    if (ah === 0x0E) {
      return { type: 'output', data: String.fromCharCode(this.getAL()) };
    } else if (ah === 0x13) {
      let output = '';
      const count = this.CX;
      const offset = this.BP;
      for (let i = 0; i < count; i++) {
        output += String.fromCharCode(this.readByte(this.ES, offset + i));
      }
      return { type: 'output', data: output };
    }
    return null;
  }

  handleDOSInterrupt() {
    const ah = this.getAH();
    if (ah === 0x09) {
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
      return { type: 'output', data: String.fromCharCode(this.getDL()) };
    } else if (ah === 0x4C) {
      this.halted = true;
      return { type: 'halt' };
    }
    return null;
  }

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
      
      const d = (opcode >> 1) & 1;
      const w = opcode & 1;
      const mod = (modrm >> 6) & 3;
      const reg = (modrm >> 3) & 7;
      const rm = modrm & 7;
      
      if (mod === 3) {
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
      
      if ((modrm >> 6) === 3) this.setReg16(rm, value);
      return null;
    }

    // MUL (F6-F7 with reg=4)
    if (opcode === 0xF6 || opcode === 0xF7) {
      const modrm = this.readByte(this.CS, this.IP);
      this.IP = (this.IP + 1) & 0xFFFF;
      const operation = (modrm >> 3) & 7;
      const w = opcode & 1;
      
      if ((modrm >> 6) === 3) {
        const reg = modrm & 7;
        
        if (operation === 4) { // MUL
          if (w) {
            const val = this.getReg16(reg);
            const result = this.AX * val;
            this.AX = result & 0xFFFF;
            this.DX = (result >> 16) & 0xFFFF;
            this.updateFlags(this.AX, 16, 'mul');
          } else {
            const val = this.getReg8(reg);
            const result = this.getAL() * val;
            this.AX = result & 0xFFFF;
            this.updateFlags(result, 8, 'mul');
          }
        } else if (operation === 6) { // DIV
          if (w) {
            const divisor = this.getReg16(reg);
            if (divisor === 0) return { type: 'error', message: 'Division by zero' };
            const dividend = (this.DX << 16) | this.AX;
            this.AX = Math.floor(dividend / divisor) & 0xFFFF;
            this.DX = (dividend % divisor) & 0xFFFF;
          } else {
            const divisor = this.getReg8(reg);
            if (divisor === 0) return { type: 'error', message: 'Division by zero' };
            const quotient = Math.floor(this.AX / divisor);
            const remainder = this.AX % divisor;
            this.setAL(quotient & 0xFF);
            this.setAH(remainder & 0xFF);
          }
        } else if (operation === 2) { // NOT
          if (w) this.setReg16(reg, (~this.getReg16(reg)) & 0xFFFF);
          else this.setReg8(reg, (~this.getReg8(reg)) & 0xFF);
        } else if (operation === 3) { // NEG
          if (w) {
            const val = this.getReg16(reg);
            const result = ((~val) + 1) & 0xFFFF;
            this.updateFlags(result, 16, 'sub', 0, val);
            this.setReg16(reg, result);
          } else {
            const val = this.getReg8(reg);
            const result = ((~val) + 1) & 0xFF;
            this.updateFlags(result, 8, 'sub', 0, val);
            this.setReg8(reg, result);
          }
        }
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

    // Conditional jumps (70-7F) - CRITICAL FOR LOOPS
    if (opcode >= 0x70 && opcode <= 0x7F) {
      const offset = this.readByte(this.CS, this.IP);
      this.IP = (this.IP + 1) & 0xFFFF;
      const signedOffset = offset > 127 ? offset - 256 : offset;
      
      let jump = false;
      switch(opcode) {
        case 0x70: jump = this.flags.OF === 1; break;
        case 0x71: jump = this.flags.OF === 0; break;
        case 0x72: jump = this.flags.CF === 1; break;
        case 0x73: jump = this.flags.CF === 0; break;
        case 0x74: jump = this.flags.ZF === 1; break;
        case 0x75: jump = this.flags.ZF === 0; break; // JNZ - KEY FOR LOOPS!
        case 0x76: jump = this.flags.CF === 1 || this.flags.ZF === 1; break;
        case 0x77: jump = this.flags.CF === 0 && this.flags.ZF === 0; break;
        case 0x78: jump = this.flags.SF === 1; break;
        case 0x79: jump = this.flags.SF === 0; break;
        case 0x7A: jump = this.flags.PF === 1; break;
        case 0x7B: jump = this.flags.PF === 0; break;
        case 0x7C: jump = this.flags.SF !== this.flags.OF; break;
        case 0x7D: jump = this.flags.SF === this.flags.OF; break;
        case 0x7E: jump = this.flags.ZF === 1 || this.flags.SF !== this.flags.OF; break;
        case 0x7F: jump = this.flags.ZF === 0 && this.flags.SF === this.flags.OF; break;
      }
      
      if (jump) {
        this.IP = (this.IP + signedOffset) & 0xFFFF;
      }
      return null;
    }

    // LOOP instructions (E0-E2) - ESSENTIAL FOR LOOP PROGRAMS
    if (opcode === 0xE2) { // LOOP
      const offset = this.readByte(this.CS, this.IP);
      this.IP = (this.IP + 1) & 0xFFFF;
      const signedOffset = offset > 127 ? offset - 256 : offset;
      
      this.CX = (this.CX - 1) & 0xFFFF;
      if (this.CX !== 0) {
        this.IP = (this.IP + signedOffset) & 0xFFFF;
      }
      return null;
    }

    if (opcode === 0xE1) { // LOOPE/LOOPZ
      const offset = this.readByte(this.CS, this.IP);
      this.IP = (this.IP + 1) & 0xFFFF;
      const signedOffset = offset > 127 ? offset - 256 : offset;
      
      this.CX = (this.CX - 1) & 0xFFFF;
      if (this.CX !== 0 && this.flags.ZF === 1) {
        this.IP = (this.IP + signedOffset) & 0xFFFF;
      }
      return null;
    }

    if (opcode === 0xE0) { // LOOPNE/LOOPNZ
      const offset = this.readByte(this.CS, this.IP);
      this.IP = (this.IP + 1) & 0xFFFF;
      const signedOffset = offset > 127 ? offset - 256 : offset;
      
      this.CX = (this.CX - 1) & 0xFFFF;
      if (this.CX !== 0 && this.flags.ZF === 0) {
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
    if (opcode === 0x90) return null;
    
    return null;
  }
}

// Assembler with Proper Label Resolution
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
          this.labels[label] = address;
          
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
        const labelName = labelMatch[1].toUpperCase();
        this.labels[labelName] = address;
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

      const instruction = cleanLine.replace(/^\w+:\s*/, '');
      if (!instruction) continue;

      const instrAddress = address;
      
      try {
        const bytes = this.parseInstruction(instruction, address);
        if (bytes) {
          machineCode.push(...bytes);
          addressToLine[instrAddress] = lineNum;
          address += bytes.length;
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

    if (op === 'MOV') return 3;
    if (['MUL', 'DIV', 'NOT', 'NEG'].includes(op)) return 2;
    if (['INC', 'DEC', 'PUSH', 'POP'].includes(op)) return 1;
    if (['JMP', 'JE', 'JNE', 'JZ', 'JNZ', 'JG', 'JL', 'JGE', 'JLE', 'JB', 'JA', 'LOOP'].includes(op)) return 2;
    if (['INT'].includes(op)) return 2;
    if (['HLT', 'NOP'].includes(op)) return 1;
    return 1;
  }

  parseInstruction(instruction, currentAddress) {
    const parts = instruction.toUpperCase().split(/[\s,]+/).filter(p => p);
    const opcode = parts[0];

    if (opcode === 'MOV') return this.assembleMOV(parts.slice(1));
    if (opcode === 'MUL') return this.assembleMUL(parts.slice(1));
    if (opcode === 'DIV') return this.assembleDIV(parts.slice(1));
    if (opcode === 'NOT') return this.assembleNOT(parts.slice(1));
    if (opcode === 'NEG') return this.assembleNEG(parts.slice(1));
    if (opcode === 'INC') return this.assembleINC(parts.slice(1));
    if (opcode === 'DEC') return this.assembleDEC(parts.slice(1));
    if (opcode === 'PUSH') return this.assemblePUSH(parts.slice(1));
    if (opcode === 'POP') return this.assemblePOP(parts.slice(1));
    if (['JMP', 'JE', 'JNE', 'JZ', 'JNZ', 'JG', 'JL', 'JGE', 'JLE', 'JB', 'JA', 'JAE', 'JBE', 'JC', 'JNC'].includes(opcode)) {
      return this.assembleJump(opcode, parts.slice(1), currentAddress);
    }
    if (opcode === 'LOOP' || opcode === 'LOOPE' || opcode === 'LOOPZ' || opcode === 'LOOPNE' || opcode === 'LOOPNZ') {
      return this.assembleLOOP(opcode, parts.slice(1), currentAddress);
    }
    if (opcode === 'INT') return [0xCD, this.parseNumber(parts[1])];
    if (opcode === 'HLT') return [0xF4];
    if (opcode === 'NOP') return [0x90];

    throw new Error(`Unknown instruction: ${opcode}`);
  }

  get regMap16() { return { AX: 0, CX: 1, DX: 2, BX: 3, SP: 4, BP: 5, SI: 6, DI: 7 }; }
  get regMap8() { return { AL: 0, CL: 1, DL: 2, BL: 3, AH: 4, CH: 5, DH: 6, BH: 7 }; }
  get segMap() { return { ES: 0, CS: 1, SS: 2, DS: 3 }; }

  assembleMOV(args) {
    const [dest, src] = args;

    if (this.segMap[dest] !== undefined && this.regMap16[src] !== undefined) {
      return [0x8E, 0xC0 + (this.segMap[dest] << 3) + this.regMap16[src]];
    }

    if (this.regMap16[dest] !== undefined && this.segMap[src] !== undefined) {
      return [0x8C, 0xC0 + (this.segMap[src] << 3) + this.regMap16[dest]];
    }

    if (this.regMap16[dest] !== undefined && (src.startsWith('0X') || /^\d+$/.test(src))) {
      const value = this.parseNumber(src);
      return [0xB8 + this.regMap16[dest], value & 0xFF, (value >> 8) & 0xFF];
    }

    if (this.regMap8[dest] !== undefined && (src.startsWith('0X') || /^\d+$/.test(src))) {
      const value = this.parseNumber(src);
      return [0xB0 + this.regMap8[dest], value & 0xFF];
    }

    if (this.regMap16[dest] !== undefined && this.regMap16[src] !== undefined) {
      return [0x89, 0xC0 + (this.regMap16[src] << 3) + this.regMap16[dest]];
    }

    if (this.regMap8[dest] !== undefined && this.regMap8[src] !== undefined) {
      return [0x88, 0xC0 + (this.regMap8[src] << 3) + this.regMap8[dest]];
    }

    if (this.regMap16[dest] !== undefined && src.startsWith('OFFSET')) {
      const labelName = src.substring(6).trim();
      const labelAddr = this.labels[labelName] || this.dataLabels[labelName]?.address || 0;
      return [0xB8 + this.regMap16[dest], labelAddr & 0xFF, (labelAddr >> 8) & 0xFF];
    }

    throw new Error(`Cannot assemble MOV ${dest}, ${src}`);
  }

  assembleMUL(args) {
    const reg = args[0];
    if (this.regMap16[reg] !== undefined) {
      return [0xF7, 0xE0 + this.regMap16[reg]];
    }
    if (this.regMap8[reg] !== undefined) {
      return [0xF6, 0xE0 + this.regMap8[reg]];
    }
    throw new Error(`Cannot assemble MUL ${reg}`);
  }

  assembleDIV(args) {
    const reg = args[0];
    if (this.regMap16[reg] !== undefined) {
      return [0xF7, 0xF0 + this.regMap16[reg]];
    }
    if (this.regMap8[reg] !== undefined) {
      return [0xF6, 0xF0 + this.regMap8[reg]];
    }
    throw new Error(`Cannot assemble DIV ${reg}`);
  }

  assembleNOT(args) {
    const reg = args[0];
    if (this.regMap16[reg] !== undefined) {
      return [0xF7, 0xD0 + this.regMap16[reg]];
    }
    if (this.regMap8[reg] !== undefined) {
      return [0xF6, 0xD0 + this.regMap8[reg]];
    }
    throw new Error(`Cannot assemble NOT ${reg}`);
  }

  assembleNEG(args) {
    const reg = args[0];
    if (this.regMap16[reg] !== undefined) {
      return [0xF7, 0xD8 + this.regMap16[reg]];
    }
    if (this.regMap8[reg] !== undefined) {
      return [0xF6, 0xD8 + this.regMap8[reg]];
    }
    throw new Error(`Cannot assemble NEG ${reg}`);
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

  assembleJump(opcode, args, currentAddress) {
    const target = args[0];
    const targetAddr = this.labels[target];
    if (targetAddr === undefined) {
      throw new Error(`Unknown label: ${target}`);
    }
    
    // Calculate relative offset from NEXT instruction
    const nextInstrAddr = currentAddress + 2;
    const offset = targetAddr - nextInstrAddr;
    
    // Convert to signed byte
    const signedByte = offset >= 0 ? offset : 256 + offset;
    
    const opcodeMap = {
      'JMP': 0xEB, 'JE': 0x74, 'JZ': 0x74, 'JNE': 0x75, 'JNZ': 0x75,
      'JG': 0x7F, 'JL': 0x7C, 'JGE': 0x7D, 'JLE': 0x7E,
      'JA': 0x77, 'JB': 0x72, 'JAE': 0x73, 'JBE': 0x76,
      'JC': 0x72, 'JNC': 0x73
    };
    
    return [opcodeMap[opcode], signedByte & 0xFF];
  }

  assembleLOOP(opcode, args, currentAddress) {
    const target = args[0];
    const targetAddr = this.labels[target];
    if (targetAddr === undefined) {
      throw new Error(`Unknown label: ${target}`);
    }
    
    // Calculate relative offset from NEXT instruction
    const nextInstrAddr = currentAddress + 2;
    const offset = targetAddr - nextInstrAddr;
    
    // Convert to signed byte
    const signedByte = offset >= 0 ? offset : 256 + offset;
    
    const opcodeMap = {
      'LOOP': 0xE2,
      'LOOPE': 0xE1, 'LOOPZ': 0xE1,
      'LOOPNE': 0xE0, 'LOOPNZ': 0xE0
    };
    
    return [opcodeMap[opcode], signedByte & 0xFF];
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
  const [code, setCode] = useState(`; 8086 Factorial Program
; Calculates 5! = 5 × 4 × 3 × 2 × 1 = 120

start:
  MOV AL, 05H    ; AL = 5
  MOV CL, 05H    ; CL = 5 (counter)
  DEC CL         ; CL = 4

L:
  MUL CL         ; AL = AL × CL
  DEC CL         ; CL = CL - 1
  JNZ L          ; Jump to L if CL ≠ 0
  HLT            ; Stop execution

; Expected Result:
; AL = 78H (120 decimal)
; CL = 00H
; ZF = 1`);
  
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
  const [stepCount, setStepCount] = useState(0);
  
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
    setOutput('Compiled successfully! Press RUN or STEP to execute.\n');
    setStepCount(0);
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
        
        setStepCount(prev => prev + 1);
        
        const result = currentCpu.step();
        
        if (result) {
          if (result.type === 'output') {
            setOutput(prev => prev + result.data);
          } else if (result.type === 'halt') {
            setTimeout(() => {
              stopProgram();
              setCurrentLine(-1);
              setOutput(prev => prev + '\n\nProgram halted successfully.');
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
    
    setStepCount(prev => prev + 1);
    
    setTimeout(() => {
      if (cpu.halted) {
        setCurrentLine(-1);
        setOutput(prev => prev + '\n\nProgram halted.');
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
        setOutput(prev => prev + '\n\nProgram halted.');
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
    setStepCount(0);
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
            <p className="text-sm text-gray-500">Complete 16-bit Microprocessor Simulator with Loop Support</p>
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
            <div className="mt-3 pt-3 border-t border-gray-700 text-xs text-gray-400">
              <div>AL (decimal): {cpu.AX & 0xFF}</div>
              <div>CL (decimal): {cpu.CX & 0xFF}</div>
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
              <h3 className="text-xs font-bold mb-2 pb-2 border-b border-blue-500">Pointer/Index</h3>
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
                <div key={flag} className={`text-center p-2 rounded ${val === 1 ? 'bg-green-700' : 'bg-gray-700'}`}>
                  <div className="font-semibold text-gray-300">{flag}</div>
                  <div className={`font-mono text-lg font-bold ${val === 1 ? 'text-green-300' : 'text-gray-500'}`}>
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
          <h3 className="text-sm font-semibold">Program Output & Status</h3>
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