export class SidPlayer {
    static loadedContexts = new WeakSet();

    constructor() {
        this.audioCtx = null;
        this.workletNode = null;
        this.isReady = false;
    }

    async initialise(existingCtx = null) {
        if (this.isReady) return;

        this.audioCtx = existingCtx || new (window.AudioContext || window.webkitAudioContext)();

        if (!SidPlayer.loadedContexts.has(this.audioCtx)) {
            const workletCode = `
                class SidProcessor extends AudioWorkletProcessor {
                    constructor() {
                        super();
                        this.port.onmessage = (e) => this.handleMessage(e.data);
                        
                        this.C64_PAL_CPUCLK = 985248;
                        this.PAL_FRAMERATE = 50;
                        this.SID_CHANNEL_AMOUNT = 3;
                        this.OUTPUT_SCALEDOWN = 0x10000 * this.SID_CHANNEL_AMOUNT * 16;
                        this.SIDamount_vol = [0, 1, 0.6, 0.4]; 
                        
                        this.memory = new Uint8Array(65536);
                        this.timermode = new Uint8Array(0x20);
                        this.preferred_SID_model = [8580.0, 8580.0, 8580.0];
                        this.SID_model = 8580.0;
                        this.SID_address = [0xD400, 0, 0];
                        
                        this.loaded = 0;
                        this.initialized = 0;
                        this.volume = 1.0;
                        this.clk_ratio = this.C64_PAL_CPUCLK / sampleRate;
                        this.frame_sampleperiod = sampleRate / this.PAL_FRAMERATE;
                        this.framecnt = 1;
                        this.CPUtime = 0;
                        this.SIDamount = 1;
                        this.mix = 0;
                        
                        this.PC = 0; this.A = 0; this.T = 0; this.X = 0; this.Y = 0; 
                        this.SP = 0xFF; this.IR = 0; this.addr = 0; this.ST = 0x00; 
                        this.cycles = 0; this.storadd = 0;
                        this.flagsw = [0x01,0x21,0x04,0x24,0x00,0x40,0x08,0x28];
                        this.branchflag = [0x80,0x40,0x01,0x02];
                        
                        this.GATE_BITMASK=0x01; this.SYNC_BITMASK=0x02; this.RING_BITMASK=0x04; 
                        this.TEST_BITMASK=0x08; this.TRI_BITMASK=0x10; this.SAW_BITMASK=0x20; 
                        this.PULSE_BITMASK=0x40; this.NOISE_BITMASK=0x80;
                        this.HOLDZERO_BITMASK=0x10; this.DECAYSUSTAIN_BITMASK=0x40; this.ATTACK_BITMASK=0x80;
                        this.FILTSW = [1,2,4,1,2,4,1,2,4]; 
                        this.LOWPASS_BITMASK=0x10; this.BANDPASS_BITMASK=0x20; 
                        this.HIGHPASS_BITMASK=0x40; this.OFF3_BITMASK=0x80;
                        
                        this.ADSRstate = new Uint8Array(9); this.ratecnt = new Float64Array(9); 
                        this.envcnt = new Float64Array(9); this.expcnt = new Float64Array(9); 
                        this.prevSR = new Uint8Array(9); this.phaseaccu = new Float64Array(9); 
                        this.prevaccu = new Float64Array(9); this.sourceMSBrise = new Uint8Array(3); 
                        this.sourceMSB = new Uint8Array(3);
                        this.noise_LFSR = new Int32Array(9);
                        for(let i=0; i<9; i++) this.noise_LFSR[i] = 0x7FFFF8;
                        this.prevwfout = new Float64Array(9); this.prevwavdata = new Float64Array(9);
                        this.prevlowpass = new Float64Array(3); this.prevbandpass = new Float64Array(3); 
                        this.cutoff_ratio_8580 = -2 * 3.14 * (12500 / 256) / sampleRate; 
                        this.cutoff_ratio_6581 = -2 * 3.14 * (20000 / 256) / sampleRate;

                        this.period0 = Math.max(this.clk_ratio, 9);
                        this.ADSRperiods = [this.period0,32,63,95,149,220,267,313,392,977,1954,3126,3907,11720,19532,31251];
                        this.ADSRstep = [Math.ceil(this.period0/9),1,1,1,1,1,1,1,1,1,1,1,1,1,1,1];
                        this.ADSR_exptable = [ 1,30,30,30,30,30,30,16,16,16,16,16,16,16,16,8,8,8,8,8,8,8,8,8,8,8,8,4,4,4,4,4,
                        4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,1,
                        1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
                        1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
                        1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1];

                        this.TriSaw_8580 = new Array(4096); this.createCombinedWF(this.TriSaw_8580,0.8,2.4,0.64);
                        this.PulseSaw_8580 = new Array(4096); this.createCombinedWF(this.PulseSaw_8580,1.4,1.9,0.68);
                        this.PulseTriSaw_8580 = new Array(4096); this.createCombinedWF(this.PulseTriSaw_8580,0.8,2.5,0.64);
                    }

                    createCombinedWF(wfarray, bitmul, bitstrength, treshold) {
                        for (let i=0; i<4096; i++) { 
                            wfarray[i]=0;
                            for (let j=0; j<12; j++) { 
                                let bitlevel=0;
                                for (let k=0; k<12; k++) { 
                                    bitlevel += ( bitmul/Math.pow(bitstrength,Math.abs(k-j)) ) * (((i>>k)&1)-0.5); 
                                }
                                wfarray[i] += (bitlevel>=treshold) ? Math.pow(2,j) : 0;  
                            }
                            wfarray[i]*=12;  
                        }
                    }

                    handleMessage(data) {
                        if (data.type === 'load') {
                            this.loadData(data.buffer, data.subtune);
                        } else if (data.type === 'volume') {
                            this.volume = data.value;
                        } else if (data.type === 'poke') {
                            this.memory[data.addr] = data.value;
                            if ((data.addr & 0xFF) === 0x04 || (data.addr & 0xFF) === 0x0B || (data.addr & 0xFF) === 0x12) {
                                const ch = Math.floor((data.addr & 0x1F) / 7);
                                if (!(data.value & 0x01)) this.ADSRstate[ch] &= 0x3E;
                            }
                        }
                    }

                    loadData(arrayBuffer, subt) {
                        const filedata = new Uint8Array(arrayBuffer);
                        const offs = filedata[7]; 
                        this.loadaddr = filedata[8]*256 + filedata[9] || filedata[offs] + filedata[offs+1]*256;
                        
                        for (let i=0; i<32; i++) this.timermode[31-i] = filedata[0x12+(i>>3)] & Math.pow(2,7-i%8); 
                        this.memory.fill(0);
                        for (let i=offs+2; i<filedata.byteLength; i++) { 
                            if (this.loadaddr+i-(offs+2) < this.memory.length) this.memory[this.loadaddr+i-(offs+2)] = filedata[i]; 
                        }
                        
                        this.initaddr = filedata[0xA]*256+filedata[0xB] || this.loadaddr; 
                        this.playaddr = filedata[0xC]*256+filedata[0xD];
                        this.playaddf = this.playaddr;
                        
                        this.preferred_SID_model[0] = (filedata[0x77]&0x30)>=0x20 ? 8580 : 6581;
                        this.SID_address[1] = filedata[0x7A]>=0x42 && (filedata[0x7A]<0x80 || filedata[0x7A]>=0xE0) ? 0xD000+filedata[0x7A]*16 : 0;
                        this.SID_address[2] = filedata[0x7B]>=0x42 && (filedata[0x7B]<0x80 || filedata[0x7B]>=0xE0) ? 0xD000+filedata[0x7B]*16 : 0;
                        this.SIDamount = 1 + (this.SID_address[1]>0) + (this.SID_address[2]>0);
                        
                        this.loaded = 1;
                        this.init(subt);
                    }

                    init(subt) {
                        if (!this.loaded) return;
                        this.initialized = 0; 
                        this.subtune = subt; 
                        this.initCPU(this.initaddr); 
                        this.initSID(); 
                        this.A = this.subtune; 
                        this.memory[1] = 0x37; 
                        this.memory[0xDC05] = 0;
                        
                        for(let timeout=100000; timeout>=0; timeout--) { 
                            if (this.CPU() >= 0xFE) break; 
                        }
                        
                        if (this.timermode[this.subtune] || this.memory[0xDC05]) { 
                            if (!this.memory[0xDC05]) { this.memory[0xDC04]=0x24; this.memory[0xDC05]=0x40; } 
                            this.frame_sampleperiod = (this.memory[0xDC04]+this.memory[0xDC05]*256) / this.clk_ratio; 
                        } else {
                            this.frame_sampleperiod = sampleRate / this.PAL_FRAMERATE; 
                        }
                        
                        if(this.playaddf == 0) {
                            this.playaddr = ((this.memory[1]&3)<2) ? this.memory[0xFFFE]+this.memory[0xFFFF]*256 : this.memory[0x314]+this.memory[0x315]*256;
                        } else { 
                            this.playaddr = this.playaddf; 
                            if (this.playaddr>=0xE000 && this.memory[1]==0x37) this.memory[1]=0x35; 
                        }
                        
                        this.initCPU(this.playaddr); 
                        this.framecnt = 1; 
                        this.CPUtime = 0; 
                        this.initialized = 1;
                    }

                    initCPU(mempos) { 
                        this.PC = mempos; this.A = 0; this.X = 0; this.Y = 0; this.ST = 0; this.SP = 0xFF; 
                    }

                    initSID() { 
                        for(let i=0xD400; i<=0xD7FF; i++) this.memory[i]=0; 
                        for(let i=0xDE00; i<=0xDFFF; i++) this.memory[i]=0;
                        for(let i=0; i<9; i++) {
                            this.ADSRstate[i] = this.HOLDZERO_BITMASK; 
                            this.ratecnt[i] = this.envcnt[i] = this.expcnt[i] = this.prevSR[i] = 0;
                        }
                    }

                    CPU() {
                        this.IR = this.memory[this.PC]; 
                        this.cycles = 2; 
                        this.storadd = 0;
                        
                        if(this.IR & 1) {
                            switch (this.IR & 0x1F) { 
                                case 1: case 3: this.addr = this.memory[this.memory[++this.PC]+this.X] + this.memory[this.memory[this.PC]+this.X+1]*256; this.cycles=6; break; 
                                case 0x11: case 0x13: this.addr = this.memory[this.memory[++this.PC]] + this.memory[this.memory[this.PC]+1]*256 + this.Y; this.cycles=6; break; 
                                case 0x19: case 0x1F: this.addr = this.memory[++this.PC] + this.memory[++this.PC]*256 + this.Y; this.cycles=5; break; 
                                case 0x1D: this.addr = this.memory[++this.PC] + this.memory[++this.PC]*256 + this.X; this.cycles=5; break; 
                                case 0xD: case 0xF: this.addr = this.memory[++this.PC] + this.memory[++this.PC]*256; this.cycles=4; break; 
                                case 0x15: this.addr = this.memory[++this.PC] + this.X; this.cycles=4; break; 
                                case 5: case 7: this.addr = this.memory[++this.PC]; this.cycles=3; break; 
                                case 0x17: this.addr = this.memory[++this.PC] + this.Y; this.cycles=4; break; 
                                case 9: case 0xB: this.addr = ++this.PC; this.cycles=2; break; 
                            }
                            this.addr &= 0xFFFF;
                            switch (this.IR & 0xE0) {
                                case 0x60: this.T=this.A; this.A+=this.memory[this.addr]+(this.ST&1); this.ST&=20; this.ST|=(this.A&128)|(this.A>255); this.A&=0xFF; this.ST|=(!this.A)<<1 | (!((this.T^this.memory[this.addr])&0x80) && ((this.T^this.A)&0x80))>>1; break; 
                                case 0xE0: this.T=this.A; this.A-=this.memory[this.addr]+!(this.ST&1); this.ST&=20; this.ST|=(this.A&128)|(this.A>=0); this.A&=0xFF; this.ST|=(!this.A)<<1 | (((this.T^this.memory[this.addr])&0x80) && ((this.T^this.A)&0x80))>>1; break; 
                                case 0xC0: this.T=this.A-this.memory[this.addr]; this.ST&=124;this.ST|=(!(this.T&0xFF))<<1|(this.T&128)|(this.T>=0); break; 
                                case 0x00: this.A|=this.memory[this.addr]; this.ST&=125;this.ST|=(!this.A)<<1|(this.A&128); break; 
                                case 0x20: this.A&=this.memory[this.addr]; this.ST&=125;this.ST|=(!this.A)<<1|(this.A&128); break; 
                                case 0x40: this.A^=this.memory[this.addr]; this.ST&=125;this.ST|=(!this.A)<<1|(this.A&128); break; 
                                case 0xA0: this.A=this.memory[this.addr]; this.ST&=125;this.ST|=(!this.A)<<1|(this.A&128); if((this.IR&3)==3) this.X=this.A; break; 
                                case 0x80: this.memory[this.addr]=this.A & (((this.IR&3)==3)?this.X:0xFF); this.storadd=this.addr; break; 
                            }
                        } else if(this.IR & 2) {
                            switch (this.IR & 0x1F) {
                                case 0x1E: this.addr = this.memory[++this.PC] + this.memory[++this.PC]*256 + ( ((this.IR&0xC0)!=0x80) ? this.X:this.Y ); this.cycles=5; break; 
                                case 0xE: this.addr = this.memory[++this.PC] + this.memory[++this.PC]*256; this.cycles=4; break; 
                                case 0x16: this.addr = this.memory[++this.PC] + ( ((this.IR&0xC0)!=0x80) ? this.X:this.Y ); this.cycles=4; break; 
                                case 6: this.addr = this.memory[++this.PC]; this.cycles=3; break; 
                                case 2: this.addr = ++this.PC; this.cycles=2; break; 
                            }
                            this.addr &= 0xFFFF;
                            switch (this.IR & 0xE0) {
                                case 0x00: this.ST&=0xFE; 
                                case 0x20: if((this.IR&0xF)==0xA) { this.A=(this.A<<1)+(this.ST&1); this.ST&=60;this.ST|=(this.A&128)|(this.A>255); this.A&=0xFF; this.ST|=(!this.A)<<1; } 
                                           else { this.T=(this.memory[this.addr]<<1)+(this.ST&1); this.ST&=60;this.ST|=(this.T&128)|(this.T>255); this.T&=0xFF; this.ST|=(!this.T)<<1; this.memory[this.addr]=this.T; this.cycles+=2; } break; 
                                case 0x40: this.ST&=0xFE; 
                                case 0x60: if((this.IR&0xF)==0xA) { this.T=this.A; this.A=(this.A>>1)+(this.ST&1)*128; this.ST&=60;this.ST|=(this.A&128)|(this.T&1); this.A&=0xFF; this.ST|=(!this.A)<<1; } 
                                           else { this.T=(this.memory[this.addr]>>1)+(this.ST&1)*128; this.ST&=60;this.ST|=(this.T&128)|(this.memory[this.addr]&1); this.T&=0xFF; this.ST|=(!this.T)<<1; this.memory[this.addr]=this.T; this.cycles+=2; } break; 
                                case 0xC0: if(this.IR&4) { this.memory[this.addr]--; this.memory[this.addr]&=0xFF; this.ST&=125;this.ST|=(!this.memory[this.addr])<<1|(this.memory[this.addr]&128); this.cycles+=2; } 
                                           else {this.X--; this.X&=0xFF; this.ST&=125;this.ST|=(!this.X)<<1|(this.X&128);} break; 
                                case 0xA0: if((this.IR&0xF)!=0xA) this.X=this.memory[this.addr]; else if(this.IR&0x10) {this.X=this.SP;break;} else this.X=this.A; this.ST&=125;this.ST|=(!this.X)<<1|(this.X&128); break; 
                                case 0x80: if(this.IR&4) {this.memory[this.addr]=this.X;this.storadd=this.addr;} else if(this.IR&0x10) this.SP=this.X; else {this.A=this.X; this.ST&=125;this.ST|=(!this.A)<<1|(this.A&128);} break; 
                                case 0xE0: if(this.IR&4) { this.memory[this.addr]++; this.memory[this.addr]&=0xFF; this.ST&=125;this.ST|=(!this.memory[this.addr])<<1|(this.memory[this.addr]&128); this.cycles+=2; } break; 
                            }
                        } else if((this.IR & 0xC) == 8) {
                            switch (this.IR & 0xF0) {
                                case 0x60: this.SP++; this.SP&=0xFF; this.A=this.memory[0x100+this.SP]; this.ST&=125;this.ST|=(!this.A)<<1|(this.A&128); this.cycles=4; break; 
                                case 0xC0: this.Y++; this.Y&=0xFF; this.ST&=125;this.ST|=(!this.Y)<<1|(this.Y&128); break; 
                                case 0xE0: this.X++; this.X&=0xFF; this.ST&=125;this.ST|=(!this.X)<<1|(this.X&128); break; 
                                case 0x80: this.Y--; this.Y&=0xFF; this.ST&=125;this.ST|=(!this.Y)<<1|(this.Y&128); break; 
                                case 0x00: this.memory[0x100+this.SP]=this.ST; this.SP--; this.SP&=0xFF; this.cycles=3; break; 
                                case 0x20: this.SP++; this.SP&=0xFF; this.ST=this.memory[0x100+this.SP]; this.cycles=4; break; 
                                case 0x40: this.memory[0x100+this.SP]=this.A; this.SP--; this.SP&=0xFF; this.cycles=3; break; 
                                case 0x90: this.A=this.Y; this.ST&=125;this.ST|=(!this.A)<<1|(this.A&128); break; 
                                case 0xA0: this.Y=this.A; this.ST&=125;this.ST|=(!this.Y)<<1|(this.Y&128); break; 
                                default: if(this.flagsw[this.IR>>5]&0x20) this.ST|=(this.flagsw[this.IR>>5]&0xDF); else this.ST&=255-(this.flagsw[this.IR>>5]&0xDF); break;
                            }
                        } else {
                            if ((this.IR & 0x1F) == 0x10) { 
                                this.PC++; this.T=this.memory[this.PC]; if(this.T&0x80) this.T-=0x100; 
                                if(this.IR&0x20) {if (this.ST&this.branchflag[this.IR>>6]) {this.PC+=this.T;this.cycles=3;}} else {if (!(this.ST&this.branchflag[this.IR>>6])) {this.PC+=this.T;this.cycles=3;}}  
                            } else {
                                switch (this.IR & 0x1F) {
                                    case 0: this.addr = ++this.PC; this.cycles=2; break; 
                                    case 0x1C: this.addr = this.memory[++this.PC] + this.memory[++this.PC]*256 + this.X; this.cycles=5; break; 
                                    case 0xC: this.addr = this.memory[++this.PC] + this.memory[++this.PC]*256; this.cycles=4; break; 
                                    case 0x14: this.addr = this.memory[++this.PC] + this.X; this.cycles=4; break; 
                                    case 4: this.addr = this.memory[++this.PC]; this.cycles=3; break; 
                                }
                                this.addr &= 0xFFFF;
                                switch (this.IR & 0xE0) {
                                    case 0x00: this.memory[0x100+this.SP]=this.PC%256; this.SP--;this.SP&=0xFF; this.memory[0x100+this.SP]=this.PC/256; this.SP--;this.SP&=0xFF; this.memory[0x100+this.SP]=this.ST; this.SP--;this.SP&=0xFF; this.PC = this.memory[0xFFFE]+this.memory[0xFFFF]*256-1; this.cycles=7; break; 
                                    case 0x20: if(this.IR&0xF) { this.ST &= 0x3D; this.ST |= (this.memory[this.addr]&0xC0) | ( !(this.A&this.memory[this.addr]) )<<1; } 
                                               else { this.memory[0x100+this.SP]=(this.PC+2)%256; this.SP--;this.SP&=0xFF; this.memory[0x100+this.SP]=(this.PC+2)/256; this.SP--;this.SP&=0xFF; this.PC=this.memory[this.addr]+this.memory[this.addr+1]*256-1; this.cycles=6; } break; 
                                    case 0x40: if(this.IR&0xF) { this.PC = this.addr-1; this.cycles=3; } 
                                               else { if(this.SP>=0xFF) return 0xFE; this.SP++;this.SP&=0xFF; this.ST=this.memory[0x100+this.SP]; this.SP++;this.SP&=0xFF; this.T=this.memory[0x100+this.SP]; this.SP++;this.SP&=0xFF; this.PC=this.memory[0x100+this.SP]+this.T*256-1; this.cycles=6; } break; 
                                    case 0x60: if(this.IR&0xF) { this.PC = this.memory[this.addr]+this.memory[this.addr+1]*256-1; this.cycles=5; } 
                                               else { if(this.SP>=0xFF) return 0xFF; this.SP++;this.SP&=0xFF; this.T=this.memory[0x100+this.SP]; this.SP++;this.SP&=0xFF; this.PC=this.memory[0x100+this.SP]+this.T*256-1; this.cycles=6; } break; 
                                    case 0xC0: this.T=this.Y-this.memory[this.addr]; this.ST&=124;this.ST|=(!(this.T&0xFF))<<1|(this.T&128)|(this.T>=0); break; 
                                    case 0xE0: this.T=this.X-this.memory[this.addr]; this.ST&=124;this.ST|=(!(this.T&0xFF))<<1|(this.T&128)|(this.T>=0); break; 
                                    case 0xA0: this.Y=this.memory[this.addr]; this.ST&=125;this.ST|=(!this.Y)<<1|(this.Y&128); break; 
                                    case 0x80: this.memory[this.addr]=this.Y; this.storadd=this.addr; break; 
                                }
                            }
                        }
                        this.PC++; this.PC&=0xFFFF; return 0;
                    }

                    combinedWF(channel, wfarray, index, differ6581) { 
                        if(differ6581 && this.SID_model==6581.0) index&=0x7FF; 
                        let combiwf = (wfarray[index]+this.prevwavdata[channel])/2; 
                        this.prevwavdata[channel]=wfarray[index]; 
                        return combiwf;
                    }

                    SID(num, SIDaddr) {
                        let filtin = 0; let output = 0;

                        for (let channel = num*this.SID_CHANNEL_AMOUNT; channel < (num+1)*this.SID_CHANNEL_AMOUNT; channel++) {
                            let prevgate = (this.ADSRstate[channel]&this.GATE_BITMASK); 
                            let chnadd = SIDaddr+(channel-num*this.SID_CHANNEL_AMOUNT)*7;
                            let ctrl = this.memory[chnadd+4]; 
                            let wf = ctrl&0xF0; 
                            let test = ctrl&this.TEST_BITMASK; 
                            let SR = this.memory[chnadd+6]; 
                            let tmp = 0;

                            if (prevgate != (ctrl&this.GATE_BITMASK)) { 
                                if (prevgate) { this.ADSRstate[channel] &= 0xFF-(this.GATE_BITMASK|this.ATTACK_BITMASK|this.DECAYSUSTAIN_BITMASK); } 
                                else { 
                                    this.ADSRstate[channel] = (this.GATE_BITMASK|this.ATTACK_BITMASK|this.DECAYSUSTAIN_BITMASK); 
                                    if ( (SR&0xF) > (this.prevSR[channel]&0xF) ) tmp=1; 
                                }                                               
                            }
                            this.prevSR[channel] = SR;
                            this.ratecnt[channel] += this.clk_ratio; 
                            if (this.ratecnt[channel] >= 0x8000) this.ratecnt[channel] -= 0x8000; 

                            let step, period;
                            if (this.ADSRstate[channel]&this.ATTACK_BITMASK) { step = this.memory[chnadd+5]>>4; period = this.ADSRperiods[step]; }
                            else if (this.ADSRstate[channel]&this.DECAYSUSTAIN_BITMASK) { step = this.memory[chnadd+5]&0xF; period = this.ADSRperiods[step]; }
                            else { step = SR&0xF; period = this.ADSRperiods[step]; }
                            step = this.ADSRstep[step];

                            if (this.ratecnt[channel] >= period && this.ratecnt[channel] < period+this.clk_ratio && tmp==0) { 
                                this.ratecnt[channel] -= period;  
                                if ( (this.ADSRstate[channel]&this.ATTACK_BITMASK) || ++this.expcnt[channel] == this.ADSR_exptable[this.envcnt[channel]] ) {
                                    if ( !(this.ADSRstate[channel]&this.HOLDZERO_BITMASK) ) {
                                        if (this.ADSRstate[channel]&this.ATTACK_BITMASK) { this.envcnt[channel]+=step; if (this.envcnt[channel]>=0xFF) { this.envcnt[channel]=0xFF; this.ADSRstate[channel] &= 0xFF-this.ATTACK_BITMASK; } }
                                        else if ( !(this.ADSRstate[channel]&this.DECAYSUSTAIN_BITMASK) || this.envcnt[channel] > (SR>>4)+(SR&0xF0) ) { 
                                            this.envcnt[channel]-=step; if (this.envcnt[channel]<=0 && this.envcnt[channel]+step!=0) { this.envcnt[channel]=0; this.ADSRstate[channel] |= this.HOLDZERO_BITMASK; } 
                                        }
                                    }
                                    this.expcnt[channel] = 0;
                                }
                            }
                            this.envcnt[channel] &= 0xFF; 

                            let accuadd = (this.memory[chnadd]+this.memory[chnadd+1]*256)*this.clk_ratio;
                            if ( test || ((ctrl&this.SYNC_BITMASK) && this.sourceMSBrise[num]) ) { this.phaseaccu[channel]=0; }
                            else { this.phaseaccu[channel] += accuadd; if (this.phaseaccu[channel]>0xFFFFFF) this.phaseaccu[channel] -= 0x1000000; }
                            let MSB = this.phaseaccu[channel]&0x800000; 
                            this.sourceMSBrise[num] = (MSB > (this.prevaccu[channel]&0x800000)) ? 1:0; 

                            let wfout = 0;
                            if (wf&this.NOISE_BITMASK) { 
                                tmp = this.noise_LFSR[channel];
                                if (((this.phaseaccu[channel]&0x100000) != (this.prevaccu[channel]&0x100000)) || accuadd>=0x100000) { 
                                    step = (tmp&0x400000)^((tmp&0x20000)<<5); 
                                    tmp = ((tmp<<1)+(step>0||test)) & 0x7FFFFF; 
                                    this.noise_LFSR[channel] = tmp; 
                                }
                                wfout = (wf&0x70) ? 0 : ((tmp&0x100000)>>5)+((tmp&0x40000)>>4)+((tmp&0x4000)>>1)+((tmp&0x800)<<1)+((tmp&0x200)<<2)+((tmp&0x20)<<5)+((tmp&0x04)<<7)+((tmp&0x01)<<8);
                            } else if (wf&this.PULSE_BITMASK) { 
                                let pw = (this.memory[chnadd+2]+(this.memory[chnadd+3]&0xF)*256)*16; 
                                tmp = accuadd>>9; 
                                if (0<pw && pw<tmp) pw=tmp; 
                                tmp ^= 0xFFFF; 
                                if(pw>tmp) pw=tmp;
                                tmp = this.phaseaccu[channel]>>8;
                                
                                if (wf == this.PULSE_BITMASK) { 
                                    step = 256/(accuadd>>16); 
                                    if (test) wfout=0xFFFF;
                                    else if (tmp < pw) { let lim = (0xFFFF-pw)*step; if (lim>0xFFFF) lim=0xFFFF; wfout = lim - (pw-tmp)*step; if (wfout<0) wfout=0; } 
                                    else { let lim = pw*step; if (lim>0xFFFF) lim=0xFFFF; wfout = (0xFFFF-tmp)*step - lim; if (wfout>=0) wfout=0xFFFF; wfout&=0xFFFF; }  
                                } else { 
                                    wfout = (tmp >= pw || test) ? 0xFFFF:0; 
                                    if (wf&this.TRI_BITMASK) {
                                        if (wf&this.SAW_BITMASK) { wfout = (wfout) ? this.combinedWF(channel,this.PulseTriSaw_8580,tmp>>4,1) : 0; } 
                                        else { tmp = this.phaseaccu[channel]^(ctrl&this.RING_BITMASK?this.sourceMSB[num]:0); wfout = (wfout) ? this.combinedWF(channel,this.PulseSaw_8580,(tmp^(tmp&0x800000?0xFFFFFF:0))>>11,0) : 0; } 
                                    } else if (wf&this.SAW_BITMASK) {
                                        wfout = (wfout) ? this.combinedWF(channel,this.PulseSaw_8580,tmp>>4,1) : 0; 
                                    }
                                }
                            } else if (wf&this.SAW_BITMASK) { 
                                wfout = this.phaseaccu[channel]>>8; 
                                if (wf&this.TRI_BITMASK) wfout = this.combinedWF(channel,this.TriSaw_8580,wfout>>4,1); 
                                else { step = accuadd/0x1200000; wfout += wfout*step; if (wfout>0xFFFF) wfout = 0xFFFF-(wfout-0x10000)/step; }  
                            } else if (wf&this.TRI_BITMASK) { 
                                tmp = this.phaseaccu[channel]^(ctrl&this.RING_BITMASK?this.sourceMSB[num]:0); 
                                wfout = (tmp^(tmp&0x800000?0xFFFFFF:0)) >> 7;
                            }

                            if (wf) this.prevwfout[channel] = wfout; 
                            else { wfout = this.prevwfout[channel]; } 
                            this.prevaccu[channel] = this.phaseaccu[channel]; 
                            this.sourceMSB[num] = MSB;            

                            if (this.memory[SIDaddr+0x17]&this.FILTSW[channel]) filtin += (wfout-0x8000)*(this.envcnt[channel]/256);
                            else if ((channel%this.SID_CHANNEL_AMOUNT)!=2 || !(this.memory[SIDaddr+0x18]&this.OFF3_BITMASK)) output += (wfout-0x8000)*(this.envcnt[channel]/256);
                        }

                        if(this.memory[1]&3) this.memory[SIDaddr+0x1B] = this.prevwfout[2]>>8; 
                        this.memory[SIDaddr+0x1C] = this.envcnt[2]; 

                        let cutoff = (this.memory[SIDaddr+0x15]&7)/8 + this.memory[SIDaddr+0x16] + 0.2;
                        let resonance = 0;
                        if (this.SID_model == 8580.0) { 
                            cutoff = 1-Math.exp(cutoff*this.cutoff_ratio_8580); 
                            resonance = Math.pow( 2, ( (4-(this.memory[SIDaddr+0x17]>>4) ) / 8) ); 
                        } else { 
                            if (cutoff<24) cutoff=0.035; 
                            else cutoff = 1-1.263*Math.exp(cutoff*this.cutoff_ratio_6581); 
                            resonance = (this.memory[SIDaddr+0x17]>0x5F) ? 8/(this.memory[SIDaddr+0x17]>>4) : 1.41; 
                        }
                        
                        let tmp_filt = filtin + this.prevbandpass[num]*resonance + this.prevlowpass[num]; 
                        if (this.memory[SIDaddr+0x18]&this.HIGHPASS_BITMASK) output -= tmp_filt;
                        tmp_filt = this.prevbandpass[num] - tmp_filt*cutoff; 
                        this.prevbandpass[num] = tmp_filt;  
                        if (this.memory[SIDaddr+0x18]&this.BANDPASS_BITMASK) output -= tmp_filt;
                        tmp_filt = this.prevlowpass[num] + tmp_filt*cutoff; 
                        this.prevlowpass[num] = tmp_filt;  
                        if (this.memory[SIDaddr+0x18]&this.LOWPASS_BITMASK) output += tmp_filt;

                        return (output/this.OUTPUT_SCALEDOWN)*(this.memory[SIDaddr+0x18]&0xF);
                    }

                    generateSample() {
                        if (this.loaded && this.initialized) { 
                            this.framecnt--; 
                            if (this.framecnt <= 0) { 
                                this.framecnt = this.frame_sampleperiod; 
                                this.PC = this.playaddr; 
                                this.SP = 0xFF; 
                                const targetCycles = this.C64_PAL_CPUCLK / this.PAL_FRAMERATE;
                                let currentCycles = 0;
                                while(currentCycles < targetCycles) {
                                    let pPC = this.PC;
                                    let res = this.CPU();
                                    if (res >= 0xFE) break; 
                                    currentCycles += this.cycles;
                                    if ((this.memory[1]&3)>1 && pPC<0xE000 && (this.PC==0xEA31 || this.PC==0xEA81)) break; 
                                }
                            }
                        }

                        this.mix = this.SID(0, 0xD400); 
                        if (this.SID_address[1]) this.mix += this.SID(1, this.SID_address[1]); 
                        if (this.SID_address[2]) this.mix += this.SID(2, this.SID_address[2]);

                        return this.mix * this.volume; 
                    }

                    process(inputs, outputs, parameters) {
                        const channelData = outputs[0][0];
                        for (let i = 0; i < channelData.length; i++) { 
                            channelData[i] = this.generateSample(); 
                        }
                        return true; 
                    }
                }
                registerProcessor('sid-processor', SidProcessor);
            `;

            try {
                const blob = new Blob([workletCode], { type: 'application/javascript' });
                const blobUrl = URL.createObjectURL(blob);
                await this.audioCtx.audioWorklet.addModule(blobUrl);
                URL.revokeObjectURL(blobUrl);
                SidPlayer.loadedContexts.add(this.audioCtx);
            } catch (error) {
                console.error("Failed to load SID worklet module:", error);
                return;
            }
        }

        try {
            this.workletNode = new AudioWorkletNode(this.audioCtx, 'sid-processor');
            this.workletNode.connect(this.audioCtx.destination);
            this.isReady = true;
            console.log("Audio pipeline secured.");
        } catch (error) {
            console.error("Failed to create SID worklet node:", error);
        }
    }

    async play(url, subtune = 0) {
        if (!this.isReady) return;

        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error("Network error: " + response.status);
            const arrayBuffer = await response.arrayBuffer();
            
            this.workletNode.port.postMessage({
                type: 'load',
                buffer: arrayBuffer,
                subtune: subtune
            });
            
            if (this.audioCtx.state === 'suspended') {
                await this.audioCtx.resume();
            }
        } catch (error) {
            console.error("Failed to acquire SID data:", error);
        }
    }

    setVolume(level) {
        if (this.workletNode) {
            this.workletNode.port.postMessage({ type: 'volume', value: level });
        }
    }

    poke(addr, value) {
        if (this.workletNode) {
            this.workletNode.port.postMessage({ type: 'poke', addr: addr, value: value });
        }
    }
}