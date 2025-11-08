import React, { useState, useRef, useEffect } from 'react';
import { Play, SkipForward, Square, HelpCircle, Terminal, Info, Sun, Moon } from 'lucide-react';

// 8086 CPU Emulator Backend
class CPU8086 {
  constructor() {
    this.reset();
  }

  reset() {
    this.AX = 0; this.BX = 0; this.CX = 0; this.DX = 0;
    this.SI = 0; this.DI = 0; this.BP = 0; this.SP = 0xFFFE;
    this.IP = 0;
    this.CS = 0; this.DS = 0; this.ES = 0; this.SS = 0;
    this.flags = {
      CF: 0, PF: 0, AF: 0, ZF: 0,
      SF: 0, TF: 0, IF: 0, DF: 0, OF: 0
    };
    this.memory = new Uint8Array(0x100000);
    this.halted = false;
    this.interruptEnabled = true;
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
    
    if (op === 'add' || op === 'sub') {
      const actualResult = op === 'add' ? operand1 + operand2 : operand1 - operand2;
      this.flags.CF = (actualResult > mask) ? 1 : 0;
      
      const sign1 = operand1 & signBit;
      const sign2 = operand2 & signBit;
      const signRes = result & signBit;
      
      if (op === 'add') {
        this.flags.OF = (sign1 === sign2 && sign1 !== signRes) ? 1 : 0;
      } else {
        this.flags.OF = (sign1 !== sign2 && sign1 !== signRes) ? 1 : 0;
      }
      
      this.flags.AF = ((operand1 & 0x0F) + (operand2 & 0x0F)) > 0x0F ? 1 : 0;
    }
  }

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
      const char = String.fromCharCode(this.getAL());
      return { type: 'output', data: char };
    } else if (ah === 0x13) {
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
      let output = '';
      let offset = this.DX;
      while (true) {
        const char = this.readByte(this.DS, offset);
        if (char === 0x24) break;
        output += String.fromCharCode(char);
        offset++;
      }
      return { type: 'output', data: output };
    } else if (ah === 0x4C) {
      this.halted = true;
      return { type: 'halt' };
    } else if (ah === 0x01) {
      return { type: 'input' };
    } else if (ah === 0x02) {
      const char = String.fromCharCode(this.getDL());
      return { type: 'output', data: char };
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
        switch(reg) {
          case 0: this.AX = value; break;
          case 1: this.CX = value; break;
          case 2: this.DX = value; break;
          case 3: this.BX = value; break;
          case 4: this.SP = value; break;
          case 5: this.BP = value; break;
          case 6: this.SI = value; break;
          case 7: this.DI = value; break;
        }
      } else {
        const value = this.readByte(this.CS, this.IP);
        this.IP = (this.IP + 1) & 0xFFFF;
        switch(reg) {
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
      return null;
    }

    // MOV to segment register (8E)
    if (opcode === 0x8E) {
      const modrm = this.readByte(this.CS, this.IP);
      this.IP = (this.IP + 1) & 0xFFFF;
      const sreg = (modrm >> 3) & 0x07;
      const rm = modrm & 0x07;
      
      let value = 0;
      if ((modrm >> 6) === 3) {
        switch(rm) {
          case 0: value = this.AX; break;
          case 1: value = this.CX; break;
          case 2: value = this.DX; break;
          case 3: value = this.BX; break;
          case 4: value = this.SP; break;
          case 5: value = this.BP; break;
          case 6: value = this.SI; break;
          case 7: value = this.DI; break;
        }
      }
      
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
      const sreg = (modrm >> 3) & 0x07;
      const rm = modrm & 0x07;
      
      let value = 0;
      switch(sreg) {
        case 0: value = this.ES; break;
        case 1: value = this.CS; break;
        case 2: value = this.SS; break;
        case 3: value = this.DS; break;
      }
      
      if ((modrm >> 6) === 3) {
        switch(rm) {
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
      return null;
    }

    // ADD reg, reg/imm (00-05)
    if (opcode >= 0x00 && opcode <= 0x05) {
      const modrm = this.readByte(this.CS, this.IP);
      this.IP = (this.IP + 1) & 0xFFFF;
      
      if (opcode === 0x01 && (modrm >> 6) === 3) {
        const reg1 = (modrm >> 3) & 0x07;
        const reg2 = modrm & 0x07;
        const regs = [this.AX, this.CX, this.DX, this.BX, this.SP, this.BP, this.SI, this.DI];
        const val1 = regs[reg1];
        const val2 = regs[reg2];
        const result = (val1 + val2) & 0xFFFF;
        
        this.updateFlags(result, 16, 'add', val1, val2);
        
        switch(reg1) {
          case 0: this.AX = result; break;
          case 1: this.CX = result; break;
          case 2: this.DX = result; break;
          case 3: this.BX = result; break;
          case 4: this.SP = result; break;
          case 5: this.BP = result; break;
          case 6: this.SI = result; break;
          case 7: this.DI = result; break;
        }
      } else if (opcode === 0x05) {
        const imm = this.readWord(this.CS, this.IP);
        this.IP = (this.IP + 2) & 0xFFFF;
        const result = (this.AX + imm) & 0xFFFF;
        this.updateFlags(result, 16, 'add', this.AX, imm);
        this.AX = result;
      }
      return null;
    }

    // SUB (28-2D)
    if (opcode >= 0x28 && opcode <= 0x2D) {
      const modrm = this.readByte(this.CS, this.IP);
      this.IP = (this.IP + 1) & 0xFFFF;
      
      if (opcode === 0x29 && (modrm >> 6) === 3) {
        const reg1 = (modrm >> 3) & 0x07;
        const reg2 = modrm & 0x07;
        const regs = [this.AX, this.CX, this.DX, this.BX, this.SP, this.BP, this.SI, this.DI];
        const val2 = regs[reg2];
        const val1 = regs[reg1];
        const result = (val2 - val1) & 0xFFFF;
        
        this.updateFlags(result, 16, 'sub', val2, val1);
        
        switch(reg2) {
          case 0: this.AX = result; break;
          case 1: this.CX = result; break;
          case 2: this.DX = result; break;
          case 3: this.BX = result; break;
          case 4: this.SP = result; break;
          case 5: this.BP = result; break;
          case 6: this.SI = result; break;
          case 7: this.DI = result; break;
        }
      } else if (opcode === 0x2D) {
        const imm = this.readWord(this.CS, this.IP);
        this.IP = (this.IP + 2) & 0xFFFF;
        const result = (this.AX - imm) & 0xFFFF;
        this.updateFlags(result, 16, 'sub', this.AX, imm);
        this.AX = result;
      }
      return null;
    }

    // INC register (40-47)
    if (opcode >= 0x40 && opcode <= 0x47) {
      const reg = opcode & 0x07;
      const regs = [this.AX, this.CX, this.DX, this.BX, this.SP, this.BP, this.SI, this.DI];
      const result = (regs[reg] + 1) & 0xFFFF;
      this.updateFlags(result, 16, 'add', regs[reg], 1);
      
      switch(reg) {
        case 0: this.AX = result; break;
        case 1: this.CX = result; break;
        case 2: this.DX = result; break;
        case 3: this.BX = result; break;
        case 4: this.SP = result; break;
        case 5: this.BP = result; break;
        case 6: this.SI = result; break;
        case 7: this.DI = result; break;
      }
      return null;
    }

    // DEC register (48-4F)
    if (opcode >= 0x48 && opcode <= 0x4F) {
      const reg = opcode & 0x07;
      const regs = [this.AX, this.CX, this.DX, this.BX, this.SP, this.BP, this.SI, this.DI];
      const result = (regs[reg] - 1) & 0xFFFF;
      this.updateFlags(result, 16, 'sub', regs[reg], 1);
      
      switch(reg) {
        case 0: this.AX = result; break;
        case 1: this.CX = result; break;
        case 2: this.DX = result; break;
        case 3: this.BX = result; break;
        case 4: this.SP = result; break;
        case 5: this.BP = result; break;
        case 6: this.SI = result; break;
        case 7: this.DI = result; break;
      }
      return null;
    }

    // PUSH register (50-57)
    if (opcode >= 0x50 && opcode <= 0x57) {
      const reg = opcode & 0x07;
      const regs = [this.AX, this.CX, this.DX, this.BX, this.SP, this.BP, this.SI, this.DI];
      this.SP = (this.SP - 2) & 0xFFFF;
      this.writeWord(this.SS, this.SP, regs[reg]);
      return null;
    }

    // POP register (58-5F)
    if (opcode >= 0x58 && opcode <= 0x5F) {
      const reg = opcode & 0x07;
      const value = this.readWord(this.SS, this.SP);
      this.SP = (this.SP + 2) & 0xFFFF;
      
      switch(reg) {
        case 0: this.AX = value; break;
        case 1: this.CX = value; break;
        case 2: this.DX = value; break;
        case 3: this.BX = value; break;
        case 4: this.SP = value; break;
        case 5: this.BP = value; break;
        case 6: this.SI = value; break;
        case 7: this.DI = value; break;
      }
      return null;
    }

    // CMP (38-3D)
    if (opcode >= 0x38 && opcode <= 0x3D) {
      if (opcode === 0x3D) {
        const imm = this.readWord(this.CS, this.IP);
        this.IP = (this.IP + 2) & 0xFFFF;
        const result = (this.AX - imm) & 0xFFFF;
        this.updateFlags(result, 16, 'sub', this.AX, imm);
      }
      return null;
    }

    // JMP (E9, EB)
    if (opcode === 0xE9) {
      const offset = this.readWord(this.CS, this.IP);
      this.IP = (this.IP + 2 + offset) & 0xFFFF;
      return null;
    }
    
    if (opcode === 0xEB) {
      const offset = this.readByte(this.CS, this.IP);
      this.IP = (this.IP + 1) & 0xFFFF;
      const signedOffset = offset > 127 ? offset - 256 : offset;
      this.IP = (this.IP + signedOffset) & 0xFFFF;
      return null;
    }

    // Conditional jumps (70-7F)
    if (opcode >= 0x70 && opcode <= 0x7F) {
      const offset = this.readByte(this.CS, this.IP);
      this.IP = (this.IP + 1) & 0xFFFF;
      const signedOffset = offset > 127 ? offset - 256 : offset;
      
      let jump = false;
      switch(opcode) {
        case 0x74: jump = this.flags.ZF === 1; break; // JE/JZ
        case 0x75: jump = this.flags.ZF === 0; break; // JNE/JNZ
        case 0x7C: jump = this.flags.SF !== this.flags.OF; break; // JL
        case 0x7E: jump = this.flags.ZF === 1 || this.flags.SF !== this.flags.OF; break; // JLE
        case 0x7F: jump = this.flags.ZF === 0 && this.flags.SF === this.flags.OF; break; // JG
        case 0x7D: jump = this.flags.SF === this.flags.OF; break; // JGE
      }
      
      if (jump) {
        this.IP = (this.IP + signedOffset) & 0xFFFF;
      }
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
    if (opcode === 0x90) {
      return null;
    }
    
    return null;
  }
}

// Assembler
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
    const lineToAddress = {};
    const addressToLine = {};
    const errors = [];

    let address = 0;
    let inDataSection = false;

    // First pass: collect labels and data
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum].trim();
      if (!line || line.startsWith(';')) continue;
      
      const cleanLine = line.split(';')[0].trim();
      if (!cleanLine) continue;

      // Check for data definitions
      if (cleanLine.match(/^\w+:\s*DB\s+/i)) {
        const match = cleanLine.match(/^(\w+):\s*DB\s+"([^"]*)"/i);
        if (match) {
          const label = match[1];
          const str = match[2];
          this.dataLabels[label] = { address, length: str.length, data: str };
          
          // Store the string in memory starting at address
          for (let i = 0; i < str.length; i++) {
            machineCode.push(str.charCodeAt(i));
          }
          address += str.length;
          continue;
        }
      }

      // Check for code labels
      const labelMatch = cleanLine.match(/^(\w+):/);
      if (labelMatch) {
        this.labels[labelMatch[1]] = address;
        const afterLabel = cleanLine.substring(labelMatch[0].length).trim();
        if (!afterLabel) continue;
      }
      
      // Track instruction addresses
      const instruction = cleanLine.replace(/^\w+:\s*/, '');
      if (!instruction) continue;
      
      lineToAddress[lineNum] = address;
      addressToLine[address] = lineNum;
      
      // Estimate instruction size
      address += this.estimateInstructionSize(instruction);
    }

    // Second pass: generate machine code for instructions
    address = 0;
    // Skip data section
    for (const dataLabel of Object.values(this.dataLabels)) {
      address += dataLabel.length;
    }

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum].trim();
      if (!line || line.startsWith(';')) continue;
      
      const cleanLine = line.split(';')[0].trim();
      if (!cleanLine) continue;

      // Skip data definitions
      if (cleanLine.match(/^\w+:\s*DB\s+/i)) continue;

      // Skip standalone labels
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
    if (upper.startsWith('MOV')) {
      if (upper.match(/[ABCD][XHL],\s*0X[0-9A-Fa-f]+/)) return 3;
      if (upper.match(/[ABCD][XHL],\s*\d+/)) return 3;
      return 2;
    }
    if (upper.startsWith('INT')) return 2;
    if (upper.startsWith('ADD') || upper.startsWith('SUB') || upper.startsWith('CMP')) {
      if (upper.match(/,\s*0X[0-9A-Fa-f]+/) || upper.match(/,\s*\d+/)) return 3;
      return 2;
    }
    if (upper.startsWith('JMP') || upper.startsWith('JE') || upper.startsWith('JNE') || 
        upper.startsWith('JG') || upper.startsWith('JL') || upper.startsWith('JZ') ||
        upper.startsWith('JNZ') || upper.startsWith('JGE') || upper.startsWith('JLE')) return 2;
    if (upper.startsWith('PUSH') || upper.startsWith('POP')) return 1;
    if (upper.startsWith('INC') || upper.startsWith('DEC')) return 1;
    if (upper.startsWith('HLT') || upper.startsWith('NOP')) return 1;
    return 1;
  }

  parseInstruction(instruction) {
    const parts = instruction.toUpperCase().split(/[\s,]+/).filter(p => p);
    const opcode = parts[0];

    if (opcode === 'MOV') return this.assembleMOV(parts.slice(1));
    if (opcode === 'ADD') return this.assembleADD(parts.slice(1));
    if (opcode === 'SUB') return this.assembleSUB(parts.slice(1));
    if (opcode === 'CMP') return this.assembleCMP(parts.slice(1));
    if (opcode === 'INC') return this.assembleINC(parts.slice(1));
    if (opcode === 'DEC') return this.assembleDEC(parts.slice(1));
    if (opcode === 'PUSH') return this.assemblePUSH(parts.slice(1));
    if (opcode === 'POP') return this.assemblePOP(parts.slice(1));
    if (opcode === 'JMP') return this.assembleJMP(parts.slice(1));
    if (opcode === 'JE' || opcode === 'JZ') return this.assembleJE(parts.slice(1));
    if (opcode === 'JNE' || opcode === 'JNZ') return this.assembleJNE(parts.slice(1));
    if (opcode === 'JG') return this.assembleJG(parts.slice(1));
    if (opcode === 'JL') return this.assembleJL(parts.slice(1));
    if (opcode === 'JGE') return this.assembleJGE(parts.slice(1));
    if (opcode === 'JLE') return this.assembleJLE(parts.slice(1));
    if (opcode === 'INT') {
      const intNum = this.parseNumber(parts[1]);
      return [0xCD, intNum];
    }
    if (opcode === 'HLT') return [0xF4];
    if (opcode === 'NOP') return [0x90];

    throw new Error(`Unknown instruction: ${opcode}`);
  }

  assembleMOV(args) {
    const dest = args[0];
    const src = args[1];

    const regMap16 = { AX: 0, CX: 1, DX: 2, BX: 3, SP: 4, BP: 5, SI: 6, DI: 7 };
    const regMap8 = { AL: 0, CL: 1, DL: 2, BL: 3, AH: 4, CH: 5, DH: 6, BH: 7 };
    const segMap = { ES: 0, CS: 1, SS: 2, DS: 3 };

    if (segMap[dest] !== undefined && regMap16[src] !== undefined) {
      return [0x8E, 0xC0 + (segMap[dest] << 3) + regMap16[src]];
    }

    if (regMap16[dest] !== undefined && segMap[src] !== undefined) {
      return [0x8C, 0xC0 + (segMap[src] << 3) + regMap16[dest]];
    }

    if (regMap16[dest] !== undefined && (src.startsWith('0X') || /^\d+$/.test(src))) {
      const value = this.parseNumber(src);
      return [0xB8 + regMap16[dest], value & 0xFF, (value >> 8) & 0xFF];
    }

    if (regMap8[dest] !== undefined && (src.startsWith('0X') || /^\d+$/.test(src))) {
      const value = this.parseNumber(src);
      return [0xB0 + regMap8[dest], value & 0xFF];
    }

    if (regMap16[dest] !== undefined && src.startsWith('OFFSET')) {
      const labelName = src.substring(6).trim();
      const labelAddr = this.labels[labelName] || this.dataLabels[labelName]?.address || 0;
      return [0xB8 + regMap16[dest], labelAddr & 0xFF, (labelAddr >> 8) & 0xFF];
    }

    throw new Error(`Cannot assemble MOV ${dest}, ${src}`);
  }

  assembleADD(args) {
    const dest = args[0];
    const src = args[1];
    const regMap16 = { AX: 0, CX: 1, DX: 2, BX: 3, SP: 4, BP: 5, SI: 6, DI: 7 };

    if (dest === 'AX' && (src.startsWith('0X') || /^\d+$/.test(src))) {
      const value = this.parseNumber(src);
      return [0x05, value & 0xFF, (value >> 8) & 0xFF];
    }

    if (regMap16[dest] !== undefined && regMap16[src] !== undefined) {
      return [0x01, 0xC0 + (regMap16[src] << 3) + regMap16[dest]];
    }

    throw new Error(`Cannot assemble ADD ${dest}, ${src}`);
  }

  assembleSUB(args) {
    const dest = args[0];
    const src = args[1];
    const regMap16 = { AX: 0, CX: 1, DX: 2, BX: 3, SP: 4, BP: 5, SI: 6, DI: 7 };

    if (dest === 'AX' && (src.startsWith('0X') || /^\d+$/.test(src))) {
      const value = this.parseNumber(src);
      return [0x2D, value & 0xFF, (value >> 8) & 0xFF];
    }

    if (regMap16[dest] !== undefined && regMap16[src] !== undefined) {
      return [0x29, 0xC0 + (regMap16[src] << 3) + regMap16[dest]];
    }

    throw new Error(`Cannot assemble SUB ${dest}, ${src}`);
  }

  assembleCMP(args) {
    const dest = args[0];
    const src = args[1];

    if (dest === 'AX' && (src.startsWith('0X') || /^\d+$/.test(src))) {
      const value = this.parseNumber(src);
      return [0x3D, value & 0xFF, (value >> 8) & 0xFF];
    }

    throw new Error(`Cannot assemble CMP ${dest}, ${src}`);
  }

  assembleINC(args) {
    const reg = args[0];
    const regMap = { AX: 0, CX: 1, DX: 2, BX: 3, SP: 4, BP: 5, SI: 6, DI: 7 };
    if (regMap[reg] !== undefined) {
      return [0x40 + regMap[reg]];
    }
    throw new Error(`Cannot assemble INC ${reg}`);
  }

  assembleDEC(args) {
    const reg = args[0];
    const regMap = { AX: 0, CX: 1, DX: 2, BX: 3, SP: 4, BP: 5, SI: 6, DI: 7 };
    if (regMap[reg] !== undefined) {
      return [0x48 + regMap[reg]];
    }
    throw new Error(`Cannot assemble DEC ${reg}`);
  }

  assemblePUSH(args) {
    const reg = args[0];
    const regMap = { AX: 0, CX: 1, DX: 2, BX: 3, SP: 4, BP: 5, SI: 6, DI: 7 };
    if (regMap[reg] !== undefined) {
      return [0x50 + regMap[reg]];
    }
    throw new Error(`Cannot assemble PUSH ${reg}`);
  }

  assemblePOP(args) {
    const reg = args[0];
    const regMap = { AX: 0, CX: 1, DX: 2, BX: 3, SP: 4, BP: 5, SI: 6, DI: 7 };
    if (regMap[reg] !== undefined) {
      return [0x58 + regMap[reg]];
    }
    throw new Error(`Cannot assemble POP ${reg}`);
  }

  assembleJMP(args) {
    const target = args[0];
    const addr = this.labels[target];
    if (addr !== undefined) {
      return [0xEB, addr & 0xFF];
    }
    throw new Error(`Unknown label: ${target}`);
  }

  assembleJE(args) {
    const target = args[0];
    const addr = this.labels[target];
    if (addr !== undefined) {
      return [0x74, addr & 0xFF];
    }
    throw new Error(`Unknown label: ${target}`);
  }

  assembleJNE(args) {
    const target = args[0];
    const addr = this.labels[target];
    if (addr !== undefined) {
      return [0x75, addr & 0xFF];
    }
    throw new Error(`Unknown label: ${target}`);
  }

  assembleJG(args) {
    const target = args[0];
    const addr = this.labels[target];
    if (addr !== undefined) {
      return [0x7F, addr & 0xFF];
    }
    throw new Error(`Unknown label: ${target}`);
  }

  assembleJL(args) {
    const target = args[0];
    const addr = this.labels[target];
    if (addr !== undefined) {
      return [0x7C, addr & 0xFF];
    }
    throw new Error(`Unknown label: ${target}`);
  }

  assembleJGE(args) {
    const target = args[0];
    const addr = this.labels[target];
    if (addr !== undefined) {
      return [0x7D, addr & 0xFF];
    }
    throw new Error(`Unknown label: ${target}`);
  }

  assembleJLE(args) {
    const target = args[0];
    const addr = this.labels[target];
    if (addr !== undefined) {
      return [0x7E, addr & 0xFF];
    }
    throw new Error(`Unknown label: ${target}`);
  }

  parseNumber(str) {
    if (str.startsWith('0X')) {
      return parseInt(str.substring(2), 16);
    }
    return parseInt(str, 10);
  }
}

// Main Component
export default function Emulator8086() {
  const [code, setCode] = useState(`; Program to show use of interrupts
; Also, Hello World program !
hello: DB "Hello World" ; store string

; actual entry point of the program, must be present
start:
MOV AH, 0x13         ; move BIOS interrupt number in AH
MOV CX, 11           ; move length of string in cx
MOV BX, 0            ; mov 0 to bx, so we can move it to es
MOV ES, BX           ; move segment start of string to es, 0
MOV BP, OFFSET hello ; move start offset of string in bp
MOV DL, 0            ; start writing from col 0
int 0x10             ; BIOS interrupt`);
  
  const [cpu, setCpu] = useState(() => new CPU8086());
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);
  const [compiled, setCompiled] = useState(false);
  const [errors, setErrors] = useState([]);
  const [darkMode, setDarkMode] = useState(false);
  const [memoryStart, setMemoryStart] = useState('00000');
  const [currentLine, setCurrentLine] = useState(-1);
  const [addressToLine, setAddressToLine] = useState({});
  
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
    }, 500);
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
    
    // Get current CPU state
    const currentIP = cpu.IP;
    const lineNum = addressToLine[currentIP];
    
    // Update the highlighted line FIRST
    if (lineNum !== undefined) {
      setCurrentLine(lineNum);
    }
    
    // Then execute the instruction and update CPU state
    setTimeout(() => {
      if (cpu.halted) {
        setCurrentLine(-1);
        return;
      }
      
      // Execute instruction
      const result = cpu.step();
      
      // Handle output
      if (result && result.type === 'output') {
        setOutput(prev => prev + result.data);
      }
      
      // Check if halted after execution
      if (cpu.halted) {
        setCurrentLine(-1);
      }
      
      // Force update by creating new CPU instance
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
    const start = parseInt(memoryStart, 16);
    const rows = [];
    for (let i = 0; i < 8; i++) {
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
      <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'} px-6 py-4`}>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-yellow-500">8086 Compiler & Emulator</h1>
          <div className="flex gap-2">
            <button className={`p-2 rounded hover:bg-gray-700`}><HelpCircle size={20} /></button>
            <button className={`p-2 rounded hover:bg-gray-700`}><Terminal size={20} /></button>
            <button className={`p-2 rounded hover:bg-gray-700`}><Info size={20} /></button>
            <button 
              onClick={() => setDarkMode(!darkMode)}
              className={`p-2 rounded hover:bg-gray-700`}
            >
              {darkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>
          </div>
        </div>
      </div>

      <div className="flex gap-4 p-4">
        <div className={`flex-1 ${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-lg shadow-lg p-4`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Code Editor</h2>
            <div className="flex gap-2">
              <button
                onClick={compile}
                className="px-4 py-2 bg-yellow-500 text-black rounded font-semibold hover:bg-yellow-600"
              >
                COMPILE
              </button>
              <button
                onClick={running ? stopProgram : runProgram}
                className={`px-4 py-2 rounded font-semibold ${running ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-700 hover:bg-gray-600'}`}
                disabled={!compiled && !running}
              >
                {running ? 'STOP' : 'RUN'}
              </button>
              <button
                onClick={step}
                className="px-4 py-2 bg-gray-700 rounded font-semibold hover:bg-gray-600"
                disabled={running}
              >
                NEXT
              </button>
              <button
                onClick={reset}
                className="px-4 py-2 bg-gray-700 rounded font-semibold hover:bg-gray-600"
              >
                RESET
              </button>
            </div>
          </div>
          
          {!compiled ? (
            <textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={`w-full h-96 font-mono text-sm p-4 rounded ${darkMode ? 'bg-gray-900 text-green-400' : 'bg-gray-50 text-gray-900'} border ${darkMode ? 'border-gray-700' : 'border-gray-300'}`}
              spellCheck={false}
            />
          ) : (
            <div className={`w-full h-96 font-mono text-sm p-4 rounded overflow-auto ${darkMode ? 'bg-gray-900' : 'bg-gray-50'} border ${darkMode ? 'border-gray-700' : 'border-gray-300'}`}>
              {code.split('\n').map((line, index) => (
                <div
                  key={index}
                  className={`px-2 py-1 transition-colors duration-150 ${
                    currentLine === index
                      ? darkMode
                        ? 'bg-yellow-500 text-black font-bold'
                        : 'bg-yellow-400 text-black font-bold'
                      : darkMode
                      ? 'text-green-400'
                      : 'text-gray-900'
                  }`}
                >
                  <span className={`inline-block w-8 text-right mr-4 select-none ${
                    currentLine === index 
                      ? 'text-gray-800 font-bold' 
                      : darkMode 
                      ? 'text-gray-500' 
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
            <div className="mt-4 p-4 bg-red-900 text-red-200 rounded">
              {errors.map((err, i) => (
                <div key={i}>Line {err.line}: {err.message}</div>
              ))}
            </div>
          )}
        </div>

        <div className="w-96 space-y-4">
          <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-lg shadow-lg p-4`}>
            <h3 className="text-sm font-bold mb-3 pb-2 border-b">Registers</h3>
            <div className="flex gap-4 mb-2 text-xs font-semibold">
              <div className="flex-1">Reg</div>
              <div className="flex-1">H</div>
              <div className="flex-1">L</div>
            </div>
            {[
              ['A', formatHex(cpu.AX >> 8, 2), formatHex(cpu.AX & 0xFF, 2)],
              ['B', formatHex(cpu.BX >> 8, 2), formatHex(cpu.BX & 0xFF, 2)],
              ['C', formatHex(cpu.CX >> 8, 2), formatHex(cpu.CX & 0xFF, 2)],
              ['D', formatHex(cpu.DX >> 8, 2), formatHex(cpu.DX & 0xFF, 2)]
            ].map(([reg, h, l]) => (
              <div key={reg} className="flex gap-4 text-sm py-1">
                <div className="flex-1 font-semibold">{reg}</div>
                <div className="flex-1 font-mono">{h}</div>
                <div className="flex-1 font-mono">{l}</div>
              </div>
            ))}
          </div>

          <div className="flex gap-4">
            <div className={`flex-1 ${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-lg shadow-lg p-4`}>
              <div className="text-sm font-semibold mb-2">Segments</div>
              {[
                ['SS', formatHex(cpu.SS)],
                ['DS', formatHex(cpu.DS)],
                ['ES', formatHex(cpu.ES)],
                ['CS', formatHex(cpu.CS)]
              ].map(([seg, val]) => (
                <div key={seg} className="flex justify-between text-sm py-1">
                  <span className="font-semibold">{seg}</span>
                  <span className="font-mono">{val}</span>
                </div>
              ))}
            </div>
            
            <div className={`flex-1 ${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-lg shadow-lg p-4`}>
              <div className="text-sm font-semibold mb-2">Pointers</div>
              {[
                ['IP', formatHex(cpu.IP)],
                ['SP', formatHex(cpu.SP)],
                ['BP', formatHex(cpu.BP)],
                ['SI', formatHex(cpu.SI)],
                ['DI', formatHex(cpu.DI)]
              ].map(([ptr, val]) => (
                <div key={ptr} className="flex justify-between text-sm py-1">
                  <span className="font-semibold">{ptr}</span>
                  <span className="font-mono">{val}</span>
                </div>
              ))}
            </div>
          </div>

          <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-lg shadow-lg p-4`}>
            <div className="text-sm font-semibold mb-2">Flags</div>
            <div className="grid grid-cols-5 gap-2 text-xs">
              {Object.entries(cpu.flags).map(([flag, val]) => (
                <div key={flag} className="text-center">
                  <div className="font-semibold">{flag}</div>
                  <div className={`font-mono ${val === 1 ? 'text-green-500 font-bold' : ''}`}>{val}</div>
                </div>
              ))}
            </div>
          </div>

          <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-lg shadow-lg p-4`}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold">Memory</div>
              <div className="flex items-center gap-2">
                <span className="text-xs">Start:</span>
                <input
                  type="text"
                  value={memoryStart}
                  onChange={(e) => setMemoryStart(e.target.value)}
                  className={`w-20 px-2 py-1 text-xs font-mono rounded ${darkMode ? 'bg-gray-900' : 'bg-gray-100'}`}
                  maxLength={5}
                />
              </div>
            </div>
            <div className="font-mono text-xs space-y-1">
              {getMemoryView().map(row => (
                <div key={row.addr} className="flex gap-1">
                  <span className="text-yellow-500">{row.addr}:</span>
                  {row.bytes.map((byte, i) => (
                    <span key={i} className={byte !== '00' ? 'text-green-400' : ''}>{byte}</span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className={`mx-4 mb-4 ${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-lg shadow-lg p-4`}>
        <div className="text-sm font-semibold mb-2">Output</div>
        <div className={`font-mono text-sm p-4 rounded min-h-24 ${darkMode ? 'bg-gray-900' : 'bg-gray-50'}`}>
          {output || <span className="text-gray-500">Program output will appear here...</span>}
        </div>
      </div>
    </div>
  );
}








