import React, { useState, useRef, useEffect } from 'react';
import { Play, SkipForward, Square, HelpCircle, Terminal, Info, Sun, Moon } from 'lucide-react';

// 8086 CPU Emulator Backend
class CPU8086 {
  constructor() {
    this.reset();
  }

  reset() {
    // 16-bit registers
    this.AX = 0; this.BX = 0; this.CX = 0; this.DX = 0;
    this.SI = 0; this.DI = 0; this.BP = 0; this.SP = 0;
    this.IP = 0;
    
    // Segment registers
    this.CS = 0; this.DS = 0; this.ES = 0; this.SS = 0;
    
    // Flags
    this.flags = {
      CF: 0, PF: 0, AF: 0, ZF: 0,
      SF: 0, TF: 0, IF: 0, DF: 0, OF: 0
    };
    
    // 1MB memory
    this.memory = new Uint8Array(0x100000);
    this.halted = false;
    this.interruptEnabled = true;
  }

  // Helper functions
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

  updateFlags(result, size = 16) {
    const mask = size === 8 ? 0xFF : 0xFFFF;
    result = result & mask;
    
    this.flags.ZF = result === 0 ? 1 : 0;
    this.flags.SF = (result & (size === 8 ? 0x80 : 0x8000)) ? 1 : 0;
    
    let parity = 0;
    let temp = result & 0xFF;
    for (let i = 0; i < 8; i++) {
      if (temp & 1) parity++;
      temp >>= 1;
    }
    this.flags.PF = (parity % 2) === 0 ? 1 : 0;
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

    if (opcode === 0x8E) {
      const modrm = this.readByte(this.CS, this.IP);
      this.IP = (this.IP + 1) & 0xFFFF;
      const sreg = (modrm >> 3) & 0x07;
      const rm = modrm & 0x07;
      
      let value = 0;
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
      
      switch(sreg) {
        case 0: this.ES = value; break;
        case 1: this.CS = value; break;
        case 2: this.SS = value; break;
        case 3: this.DS = value; break;
      }
      return null;
    }

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
      return null;
    }
    
    if (opcode === 0xCD) {
      const intNum = this.readByte(this.CS, this.IP);
      this.IP = (this.IP + 1) & 0xFFFF;
      return this.interrupt(intNum);
    }
    
    if (opcode === 0xF4) {
      this.halted = true;
      return { type: 'halt' };
    }
    
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
    this.currentAddress = 0;
    this.lineToAddress = {};
    this.addressToLine = {};
  }

  assemble(code) {
    const lines = code.split('\n');
    const machineCode = [];
    this.labels = {};
    this.currentAddress = 0;
    this.lineToAddress = {};
    this.addressToLine = {};
    const errors = [];

    let address = 0;
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum].trim();
      if (!line || line.startsWith(';')) continue;
      
      const labelMatch = line.match(/^(\w+):/);
      if (labelMatch) {
        this.labels[labelMatch[1]] = address;
        continue;
      }
      
      const cleanLine = line.split(';')[0].trim();
      if (!cleanLine) continue;
      
      this.lineToAddress[lineNum] = address;
      this.addressToLine[address] = lineNum;
      
      if (line.includes('MOV') && line.includes(',')) {
        if (line.match(/[ABCD][XHL],\s*0x[0-9A-Fa-f]+/)) {
          address += 3;
        } else if (line.match(/[ABCD][HL],\s*\d+/)) {
          address += 2;
        } else if (line.match(/MOV\s+[A-Z]{2},\s*[A-Z]{2}/i)) {
          address += 2;
        } else {
          address += 2;
        }
      } else if (line.includes('INT')) {
        address += 2;
      } else if (line.includes('HLT')) {
        address += 1;
      } else if (line.includes('NOP')) {
        address += 1;
      }
    }

    address = 0;
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum].trim();
      if (!line || line.startsWith(';')) continue;
      
      const cleanLine = line.split(';')[0].trim();
      if (!cleanLine || cleanLine.endsWith(':')) continue;

      try {
        const instruction = this.parseInstruction(cleanLine);
        if (instruction) {
          machineCode.push(...instruction);
        }
      } catch (e) {
        errors.push({ line: lineNum + 1, message: e.message });
      }
    }

    return { machineCode, errors, labels: this.labels, addressToLine: this.addressToLine };
  }

  parseInstruction(instruction) {
    const parts = instruction.toUpperCase().split(/[\s,]+/).filter(p => p);
    const opcode = parts[0];

    if (opcode === 'MOV') {
      return this.assembleMOV(parts.slice(1));
    } else if (opcode === 'INT') {
      const intNum = this.parseNumber(parts[1]);
      return [0xCD, intNum];
    } else if (opcode === 'HLT') {
      return [0xF4];
    } else if (opcode === 'NOP') {
      return [0x90];
    }

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
      const labelAddr = this.labels[labelName];
      if (labelAddr !== undefined) {
        return [0xB8 + regMap16[dest], labelAddr & 0xFF, (labelAddr >> 8) & 0xFF];
      }
      return [0xB8 + regMap16[dest], 0, 0];
    }

    throw new Error(`Cannot assemble MOV ${dest}, ${src}`);
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
      return;
    }
    setRunning(true);
    
    runIntervalRef.current = setInterval(() => {
      setCpu(currentCpu => {
        const lineNum = addressToLine[currentCpu.IP];
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
        return Object.assign(newCpu, currentCpu);
      });
    }, 300);
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
      return;
    }
    
    setCpu(currentCpu => {
      const lineNum = addressToLine[currentCpu.IP];
      if (lineNum !== undefined) {
        setCurrentLine(lineNum);
      }
      
      const result = currentCpu.step();
      if (result && result.type === 'output') {
        setOutput(prev => prev + result.data);
      }
      
      if (currentCpu.halted) {
        setCurrentLine(-1);
      }
      
      const newCpu = new CPU8086();
      return Object.assign(newCpu, currentCpu);
    });
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
          <h1 className="text-2xl font-bold text-yellow-500">8086 Compiler</h1>
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
            <div className="flex gap-4 mb-4 text-sm font-semibold border-b pb-2">
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
                ['ES', formatHex(cpu.ES)]
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
            <div className="text-sm font-semibold mb-2">Flags:</div>
            <div className="grid grid-cols-5 gap-2 text-xs">
              {Object.entries(cpu.flags).map(([flag, val]) => (
                <div key={flag} className="text-center">
                  <div className="font-semibold">{flag}</div>
                  <div className="font-mono">{val}</div>
                </div>
              ))}
            </div>
          </div>

{/* Memory View */}
          <div className={`${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-lg shadow-lg p-4`}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold">Memory</div>
              <div className="flex items-center gap-2">
                <span className="text-xs">Start Address</span>
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
                  <span className="text-yellow-500">{row.addr}</span>
                  {row.bytes.map((byte, i) => (
                    <span key={i}>{byte}</span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Output Section */}
      <div className={`mx-4 mb-4 ${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-lg shadow-lg p-4`}>
        <div className="text-sm font-semibold mb-2">Output</div>
        <div className={`font-mono text-sm p-4 rounded min-h-24 ${darkMode ? 'bg-gray-900' : 'bg-gray-50'}`}>
          {output || <span className="text-gray-500">Program output will appear here...</span>}
        </div>
      </div>
    </div>
  );
}

