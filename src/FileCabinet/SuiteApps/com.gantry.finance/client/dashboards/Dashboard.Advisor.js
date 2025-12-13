/**
 * Dashboard.Advisor.js
 * Premium AI Financial Advisor Interface
 * 
 * Features:
 * - Transparent tool call steps (collapsible)
 * - Progressive message rendering
 * - Model/provider display
 * - Session persistence
 * - Responsive & accessible
 */
(function(window) {
    'use strict';

    // Constants
    const STORAGE_KEY = 'gantry_advisor_session';           // localStorage - persists across reloads
    const ACTIVE_REQUEST_KEY = 'gantry_advisor_active_req'; // sessionStorage - cleared on reload
    const MAX_HISTORY = 50;
    
    // State
    let messages = [];
    let isProcessing = false;
    let sessionContext = {
        resolvedEntities: {},
        entityOrder: [],      // Tracks chronological order of entity mentions for pronoun resolution
        topics: [],           // Conversation topics for context
        queryHistory: []      // Recent query history
    };  // Persists entity resolutions and context across messages
    let activeRequest = null;  // Tracks in-flight request for resume on navigation
    let currentPollingId = null;  // Unique ID for current polling loop to detect stale loops

    /**
     * Geometric Animation Controller
     * Phases: birth → pause → orbGlow → explode → orbit → converge → shine → ambient
     */
    const GeometricAnimation = {
        canvas: null,
        ctx: null,
        particles: [],
        animationId: null,
        phase: 'idle',
        isActive: false,
        globalTime: 0,
        orbitAngle: 0,

        config: {
            particleCount: 280,
            connectionDistance: 70,
            particleSize: { min: 0.8, max: 2.8 },
            // Timing for smooth, premium animation
            birthDuration: 800,
            glowDuration: 400,
            explodeDuration: 1800,        // Longer explosion with integrated orbit
            orbitBlendDuration: 800,      // Time to blend into full orbit mode
            floatDuration: 1200,          // Time floating before converge
            convergeDuration: 900,        // Elegant flow to input
            shineDuration: 650,           // Satisfying glow payoff
            colors: [
                { r: 99, g: 102, b: 241 },   // Indigo
                { r: 139, g: 92, b: 246 },   // Purple
                { r: 6, g: 182, b: 212 },    // Cyan
                { r: 59, g: 130, b: 246 }    // Blue
            ]
        },

        init: function() {
            this.canvas = document.getElementById('geometric-canvas');
            if (!this.canvas) return;

            this.ctx = this.canvas.getContext('2d');
            this.resize();
            this.boundResize = this.resize.bind(this);
            window.addEventListener('resize', this.boundResize);

            this.isActive = true;
            this.globalTime = 0;
            this.cameraOffsetX = 0; // For camera rotation effect
            this.createParticles();
            this.startBirth();
        },

        resize: function() {
            if (!this.canvas) return;
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
        },

        getBrainCenter: function() {
            const heroOrb = document.querySelector('.hero-orb');
            if (heroOrb) {
                const rect = heroOrb.getBoundingClientRect();
                // Use exact center of the orb-core (the brain icon background)
                const orbCore = heroOrb.querySelector('.orb-core');
                if (orbCore) {
                    const coreRect = orbCore.getBoundingClientRect();
                    return {
                        x: coreRect.left + coreRect.width / 2,
                        y: coreRect.top + coreRect.height / 2,
                        element: heroOrb
                    };
                }
                return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, element: heroOrb };
            }
            return { x: this.canvas.width / 2, y: this.canvas.height * 0.25, element: null };
        },

        createParticles: function() {
            this.particles = [];
            const center = this.getBrainCenter();

            // Initialize global camera state for 3D panning effect
            this.cameraX = 0;
            this.cameraY = 0;
            this.cameraTargetX = 0;
            this.cameraTargetY = 0;

            for (let i = 0; i < this.config.particleCount; i++) {
                const angle = (i / this.config.particleCount) * Math.PI * 2 + Math.random() * 0.3;
                const colorIndex = i % this.config.colors.length;
                const orbitRadius = 150 + Math.random() * 250;
                const orbitSpeed = 0.3 + Math.random() * 0.4;

                // Depth layer for 3D parallax (0.3 = far, 1.0 = near)
                const depth = 0.3 + Math.random() * 0.7;
                // Size scales with depth - near particles are larger
                const baseSize = (this.config.particleSize.min + Math.random() * (this.config.particleSize.max - this.config.particleSize.min)) * depth;

                this.particles.push({
                    x: center.x,
                    y: center.y,
                    angle: angle,
                    orbitRadius: orbitRadius,
                    orbitSpeed: orbitSpeed,
                    orbitOffset: Math.random() * Math.PI * 2,
                    size: baseSize,
                    baseSize: baseSize,
                    opacity: 0,
                    targetOpacity: (0.2 + Math.random() * 0.2) * depth, // Far particles more transparent
                    colorIndex: colorIndex,
                    colorOffset: Math.random() * Math.PI * 2,
                    expandX: 0,
                    expandY: 0,
                    depth: depth, // 3D depth layer
                    orbitAngle: Math.random() * Math.PI * 2 // Individual orbit angle for 3D rotation
                });
            }
        },

        getParticleColor: function(particle, opacity) {
            const colors = this.config.colors;
            const t = (this.globalTime * 0.001 + particle.colorOffset) % (Math.PI * 2);
            const colorT = (Math.sin(t) + 1) / 2;

            const c1 = colors[particle.colorIndex];
            const c2 = colors[(particle.colorIndex + 1) % colors.length];

            const r = Math.round(c1.r + (c2.r - c1.r) * colorT);
            const g = Math.round(c1.g + (c2.g - c1.g) * colorT);
            const b = Math.round(c1.b + (c2.b - c1.b) * colorT);

            return `rgba(${r}, ${g}, ${b}, ${opacity})`;
        },

        /**
         * Birth: INVISIBLE - just wait, orb glows
         * Particles don't show until explode
         */
        startBirth: function() {
            this.phase = 'birth';
            const center = this.getBrainCenter();
            const heroOrb = center.element;

            // All particles start invisible at center
            this.particles.forEach(p => {
                p.x = center.x;
                p.y = center.y;
                p.opacity = 0; // INVISIBLE
            });

            // Start orb glow immediately
            if (heroOrb) {
                heroOrb.classList.add('orb-charging');
            }

            // Just wait for glow duration, then explode
            setTimeout(() => {
                if (heroOrb) heroOrb.classList.remove('orb-charging');
                if (this.isActive) this.startExplode();
            }, this.config.glowDuration);
        },

        /**
         * Explode + Float: Seamless explosion that smoothly transitions into orbital floating
         * No abrupt phase change - motion evolves continuously
         */
        startExplode: function() {
            this.phase = 'explode';
            const startTime = Date.now();
            const center = this.getBrainCenter();
            const padding = 80;
            const chatInput = document.getElementById('advisor-input-full');

            // Global orbit center for the float phase
            const orbitCenterX = this.canvas.width / 2;
            const orbitCenterY = this.canvas.height * 0.45;

            // Initialize camera for smooth panning
            this.cameraX = 0;
            this.cameraY = 0;
            let cameraPanAngle = 0;

            // Reset particles to center and set up all motion parameters upfront
            this.particles.forEach((p, i) => {
                p.originX = center.x;
                p.originY = center.y;
                p.x = center.x;
                p.y = center.y;

                // Explosion target - where particle lands after burst
                p.expandX = padding + Math.random() * (this.canvas.width - padding * 2);
                p.expandY = padding + Math.random() * (this.canvas.height - padding * 2);

                // Pre-calculate orbit parameters so motion can blend in during explosion
                p.orbitSpeed3D = 0.12 + Math.random() * 0.08;
                p.orbitPhase3D = Math.random() * Math.PI * 2;
                p.microDriftFreq = 0.3 + Math.random() * 0.25;
                p.microDriftPhase = Math.random() * Math.PI * 2;
                p.microDriftAmp = 12 + Math.random() * 18;

                // Stagger for wave-like explosion
                p.stagger = (i / this.particles.length) * 0.15;
            });

            // Show cards once explosion is underway
            let cardsShown = false;

            const totalDuration = this.config.explodeDuration + this.config.orbitBlendDuration + this.config.floatDuration;

            const animateExplodeAndFloat = () => {
                if (!this.isActive || this.phase !== 'explode') return;

                const elapsed = Date.now() - startTime;
                const totalProgress = Math.min(elapsed / totalDuration, 1);
                this.globalTime += 16;
                const time = elapsed * 0.001;

                // Phase blending factors
                const explosionProgress = Math.min(elapsed / this.config.explodeDuration, 1);
                const blendStart = this.config.explodeDuration * 0.6; // Start blending orbit at 60% of explosion
                const blendProgress = Math.max(0, Math.min(1, (elapsed - blendStart) / this.config.orbitBlendDuration));
                const orbitBlend = this.easeInOutQuad(blendProgress); // Smooth S-curve blend

                // Show cards mid-explosion
                if (!cardsShown && explosionProgress > 0.5) {
                    cardsShown = true;
                    var scoreCategories = document.getElementById('score-categories');
                    if (scoreCategories) {
                        scoreCategories.classList.add('cards-visible');
                    }
                }

                // Camera pan - starts subtly during explosion, full effect during float
                cameraPanAngle += 0.06 * 0.016 * (0.3 + orbitBlend * 0.7);
                const cameraPanRadius = 20 + orbitBlend * 15;
                this.cameraX += (Math.sin(cameraPanAngle) * cameraPanRadius - this.cameraX) * 0.02;
                this.cameraY += (Math.cos(cameraPanAngle * 0.7) * cameraPanRadius * 0.5 - this.cameraY) * 0.02;

                this.particles.forEach((p, i) => {
                    // Staggered explosion progress
                    const particleExplosion = Math.max(0, Math.min(1, (explosionProgress - p.stagger) / (1 - p.stagger)));
                    const explosionEased = this.easeOutExpo(particleExplosion);

                    // Base position from explosion
                    const explosionX = p.originX + (p.expandX - p.originX) * explosionEased;
                    const explosionY = p.originY + (p.expandY - p.originY) * explosionEased;

                    // Orbit motion (calculated from current position relative to center)
                    const distFromCenterX = explosionX - orbitCenterX;
                    const distFromCenterY = explosionY - orbitCenterY;

                    const rotAngle = time * p.orbitSpeed3D + p.orbitPhase3D;
                    const depthRotation = rotAngle * p.depth;

                    // 3D-like rotation
                    const rotatedX = distFromCenterX * Math.cos(depthRotation * 0.25) - distFromCenterY * Math.sin(depthRotation * 0.12) * 0.25;
                    const rotatedY = distFromCenterY * Math.cos(depthRotation * 0.18) + distFromCenterX * Math.sin(depthRotation * 0.12) * 0.18;

                    // Micro-drift for organic floating
                    const microX = Math.sin(time * p.microDriftFreq + p.microDriftPhase) * p.microDriftAmp;
                    const microY = Math.cos(time * p.microDriftFreq * 0.8 + p.microDriftPhase) * p.microDriftAmp * 0.7;

                    // Parallax from camera movement
                    const parallaxX = this.cameraX * p.depth * 1.8;
                    const parallaxY = this.cameraY * p.depth * 1.8;

                    // Orbit position (what it would be in full orbit mode)
                    const orbitX = orbitCenterX + rotatedX + microX + parallaxX;
                    const orbitY = orbitCenterY + rotatedY + microY + parallaxY;

                    // Blend between explosion trajectory and orbit motion
                    p.x = explosionX + (orbitX - explosionX) * orbitBlend;
                    p.y = explosionY + (orbitY - explosionY) * orbitBlend;

                    // Opacity fades in during explosion
                    const fadeIn = Math.min(1, particleExplosion * 2);
                    const zPhase = Math.sin(rotAngle + p.orbitPhase3D);
                    p.opacity = p.targetOpacity * fadeIn * (0.75 + zPhase * 0.25 * orbitBlend);

                    // Size breathing increases as we enter orbit mode
                    p.size = p.baseSize * (1 - orbitBlend * 0.1 + zPhase * 0.15 * orbitBlend);
                });

                this.draw();

                // Subtle input glow buildup in final phase
                if (chatInput && totalProgress > 0.7) {
                    const glowProgress = (totalProgress - 0.7) / 0.3;
                    chatInput.style.boxShadow = `0 0 ${5 + 8 * glowProgress}px rgba(99, 102, 241, ${0.12 * glowProgress})`;
                }

                if (totalProgress < 1) {
                    this.animationId = requestAnimationFrame(animateExplodeAndFloat);
                } else {
                    this.startConverge();
                }
            };

            this.animationId = requestAnimationFrame(animateExplodeAndFloat);
        },

        /**
         * Converge: slower, more dramatic flow to the text box
         */
        startConverge: function() {
            this.phase = 'converge';
            const startTime = Date.now();

            const chatInput = document.getElementById('advisor-input-full');
            const inputWrapper = chatInput ? chatInput.closest('.advisor-input-area') : null;
            const chatRect = chatInput ? chatInput.getBoundingClientRect() : null;
            const targetX = chatRect ? chatRect.left + chatRect.width / 2 : this.canvas.width / 2;
            const targetY = chatRect ? chatRect.top + chatRect.height / 2 : this.canvas.height * 0.9;

            this.particles.forEach(p => {
                p.originX = p.x;
                p.originY = p.y;
                p.originSize = p.size;
            });

            const animateConverge = () => {
                if (!this.isActive || this.phase !== 'converge') return;

                const elapsed = Date.now() - startTime;
                const progress = Math.min(elapsed / this.config.convergeDuration, 1);
                this.globalTime += 16;

                this.particles.forEach((p, i) => {
                    // More dramatic stagger
                    const stagger = (i / this.particles.length) * 0.4;
                    const particleProgress = Math.max(0, Math.min(1, (progress - stagger) / (1 - stagger)));

                    if (particleProgress > 0) {
                        // Slower, more dramatic easing
                        const t = this.easeInOutCubic(particleProgress);

                        // Sweeping curve toward target
                        const controlOffsetX = (p.originX < targetX ? -1 : 1) * 100;
                        const midY = Math.min(p.originY, targetY) - 80;
                        const bez = this.quadraticBezier(
                            p.originX, p.originY,
                            (p.originX + targetX) / 2 + controlOffsetX, midY,
                            targetX, targetY,
                            t
                        );
                        p.x = bez.x;
                        p.y = bez.y;

                        // Shrink and fade slightly as they converge
                        p.size = p.originSize * (1 - particleProgress * 0.5);
                        p.opacity = p.targetOpacity * (1 - particleProgress * 0.3);
                    }
                });

                this.draw();

                // Progressive glow buildup - accelerates as particles approach
                if (chatInput && progress > 0.2) {
                    const glowProgress = (progress - 0.2) / 0.8;
                    const glowIntensity = this.easeOutQuart(glowProgress);
                    // Glow grows as particles converge, peaking just before shine
                    const glowSize = 6 + 10 * glowIntensity;
                    const outerSize = 12 + 14 * glowIntensity;
                    const glowOpacity = 0.15 + 0.25 * glowIntensity;
                    const outerOpacity = 0.08 + 0.12 * glowIntensity;
                    chatInput.style.boxShadow = `
                        0 0 ${glowSize}px rgba(99, 102, 241, ${glowOpacity}),
                        0 0 ${outerSize}px rgba(139, 92, 246, ${outerOpacity})
                    `;
                }

                if (progress < 1) {
                    this.animationId = requestAnimationFrame(animateConverge);
                } else {
                    this.triggerInputShine(chatInput, inputWrapper);
                }
            };

            this.animationId = requestAnimationFrame(animateConverge);
        },

        triggerInputShine: function(chatInput, inputWrapper) {
            if (!chatInput) {
                this.startAmbient();
                return;
            }

            if (inputWrapper) {
                inputWrapper.classList.add('input-shine-active');
            }

            const shineStart = Date.now();

            const animateShine = () => {
                const elapsed = Date.now() - shineStart;
                const progress = Math.min(elapsed / this.config.shineDuration, 1);

                // Smooth envelope - quick rise, satisfying sustain, gentle fade
                const envelope = progress < 0.15
                    ? this.easeOutQuart(progress / 0.15) // Quick attack
                    : progress < 0.7
                        ? 1 // Sustain at peak
                        : 1 - this.easeInOutQuad((progress - 0.7) / 0.3); // Gentle release

                // Premium shimmer - multiple frequencies for organic sparkle
                const shimmer1 = Math.sin(progress * Math.PI * 6) * 0.15; // Fast sparkle
                const shimmer2 = Math.sin(progress * Math.PI * 3.5 + 0.3) * 0.1; // Medium wave
                const shimmer3 = Math.sin(progress * Math.PI * 2) * 0.08; // Slow pulse
                const shimmerCombined = 1 + shimmer1 + shimmer2 + shimmer3;

                // Visible but elegant glow - layered for depth
                const baseGlow = 12 * envelope * shimmerCombined;
                const outerGlow = 20 * envelope * shimmerCombined;
                const glowOpacity = 0.35 * envelope;
                const outerOpacity = 0.15 * envelope;

                // Premium multi-layer glow with color gradient
                chatInput.style.boxShadow = `
                    0 0 ${baseGlow}px rgba(99, 102, 241, ${glowOpacity}),
                    0 0 ${outerGlow}px rgba(139, 92, 246, ${outerOpacity}),
                    inset 0 0 ${3 * envelope}px rgba(255, 255, 255, ${0.1 * envelope})
                `;

                if (progress < 1) {
                    this.animationId = requestAnimationFrame(animateShine);
                } else {
                    chatInput.style.boxShadow = '';
                    if (inputWrapper) {
                        inputWrapper.classList.remove('input-shine-active');
                    }
                    this.startAmbient();
                }
            };

            this.animationId = requestAnimationFrame(animateShine);
        },

        quadraticBezier: function(x0, y0, x1, y1, x2, y2, t) {
            const mt = 1 - t;
            return {
                x: mt * mt * x0 + 2 * mt * t * x1 + t * t * x2,
                y: mt * mt * y0 + 2 * mt * t * y1 + t * t * y2
            };
        },

        startAmbient: function() {
            this.phase = 'ambient';

            // Show the score-category cards now that animation is complete
            var scoreCategories = document.getElementById('score-categories');
            if (scoreCategories) {
                scoreCategories.classList.add('cards-visible');
            }

            this.particles.forEach(p => {
                p.x = 50 + Math.random() * (this.canvas.width - 100);
                p.y = 50 + Math.random() * (this.canvas.height - 100);
                p.vx = (Math.random() - 0.5) * 0.12;
                p.vy = (Math.random() - 0.5) * 0.12;
                p.opacity = 0; // Start invisible
                p.targetOpacity = 0.1 + Math.random() * 0.08;
                p.size = this.config.particleSize.min + Math.random() * (this.config.particleSize.max - this.config.particleSize.min);
            });

            const animateAmbient = () => {
                if (!this.isActive || this.phase !== 'ambient') return;
                this.globalTime += 16;

                this.particles.forEach(p => {
                    p.x += p.vx;
                    p.y += p.vy;
                    // Much slower fade in (0.004 instead of 0.02)
                    p.opacity += (p.targetOpacity - p.opacity) * 0.004;

                    if (p.x < 20 || p.x > this.canvas.width - 20) p.vx *= -1;
                    if (p.y < 20 || p.y > this.canvas.height - 20) p.vy *= -1;

                    p.vx += (Math.random() - 0.5) * 0.003;
                    p.vy += (Math.random() - 0.5) * 0.003;
                    p.vx = Math.max(-0.15, Math.min(0.15, p.vx));
                    p.vy = Math.max(-0.15, Math.min(0.15, p.vy));
                });

                this.draw();
                this.animationId = requestAnimationFrame(animateAmbient);
            };

            this.animationId = requestAnimationFrame(animateAmbient);
        },

        startDeparture: function() {
            if (this.phase === 'departure' || this.phase === 'idle') return;

            this.phase = 'departure';
            const startTime = Date.now();
            const duration = 600;

            const animateDeparture = () => {
                if (!this.isActive) return;

                const elapsed = Date.now() - startTime;
                const progress = Math.min(elapsed / duration, 1);
                this.globalTime += 16;

                this.particles.forEach(p => {
                    p.opacity = p.targetOpacity * (1 - this.easeInQuad(progress));
                });

                this.draw();

                if (progress < 1) {
                    this.animationId = requestAnimationFrame(animateDeparture);
                } else {
                    this.cleanup();
                }
            };

            this.animationId = requestAnimationFrame(animateDeparture);
        },

        draw: function() {
            if (!this.ctx) return;
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

            // Sort particles by depth for proper 3D layering (far particles drawn first)
            const sortedParticles = [...this.particles].sort((a, b) => (a.depth || 0.5) - (b.depth || 0.5));

            // Draw particles with subtle glow for depth
            sortedParticles.forEach(p => {
                const depth = p.depth || 0.5;

                // Add subtle glow for near particles (premium effect)
                if (depth > 0.7 && p.opacity > 0.15) {
                    const glowSize = p.size * 2.5;
                    const gradient = this.ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowSize);
                    gradient.addColorStop(0, this.getParticleColor(p, p.opacity * 0.3));
                    gradient.addColorStop(1, this.getParticleColor(p, 0));
                    this.ctx.beginPath();
                    this.ctx.arc(p.x, p.y, glowSize, 0, Math.PI * 2);
                    this.ctx.fillStyle = gradient;
                    this.ctx.fill();
                }

                // Draw particle core
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                this.ctx.fillStyle = this.getParticleColor(p, p.opacity);
                this.ctx.fill();
            });
        },

        cleanup: function() {
            this.isActive = false;
            this.phase = 'idle';
            if (this.animationId) {
                cancelAnimationFrame(this.animationId);
                this.animationId = null;
            }
            if (this.ctx) {
                this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            }
            if (this.canvas) {
                this.canvas.style.opacity = '0';
            }
            if (this.boundResize) {
                window.removeEventListener('resize', this.boundResize);
            }
            // Clean up orb class if still present
            const heroOrb = document.querySelector('.hero-orb');
            if (heroOrb) heroOrb.classList.remove('orb-charging');
        },

        // Easing functions
        easeOutExpo: function(t) {
            return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
        },
        easeOutCubic: function(t) {
            return 1 - Math.pow(1 - t, 3);
        },
        easeOutQuart: function(t) {
            return 1 - Math.pow(1 - t, 4);
        },
        easeOutSine: function(t) {
            return Math.sin((t * Math.PI) / 2);
        },
        easeInOutQuad: function(t) {
            return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        },
        easeInOutCubic: function(t) {
            return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        },
        easeInQuad: function(t) {
            return t * t;
        }
    };

    /**
     * Advisor Controller
     */
    const AdvisorController = {
        
        /**
         * Initialize the advisor dashboard
         */
        init: function() {
            messages = messages || [];

            const container = document.getElementById('gantry-view-container');
            const tpl = document.getElementById('tpl-advisor');

            if (!tpl) {
                console.error('[Advisor] Template not found');
                return;
            }

            container.innerHTML = tpl.innerHTML;

            // Add dynamic CSS for metric labels and charts
            this.injectDynamicStyles();

            // Hide floating panel if exists
            const fab = document.getElementById('advisor-fab');
            const panel = document.getElementById('advisor-panel');
            if (fab) fab.style.display = 'none';
            if (panel) panel.classList.remove('open');

            this.loadSession();
            this.renderCategories(); // Render category buttons dynamically
            this.fetchDashboardScores(); // Fetch and render health scores
            this.bindEvents();
            this.renderAllMessages();

            // Initialize geometric animation only if no messages (new session)
            if (messages.length === 0) {
                GeometricAnimation.init();
            }

            // Check for and resume any active request from before navigation
            if (activeRequest && activeRequest.requestId) {
                console.log('[Advisor] Found active request to resume:', activeRequest.requestId);
                // Resume polling in background (don't await - let init complete)
                this.resumeActiveRequest(activeRequest);
            }

            console.log('[Advisor] Initialized');
        },
        
        /**
         * Inject dynamic styles for advisor components
         */
        injectDynamicStyles: function() {
            if (document.getElementById('advisor-dynamic-styles')) return;
            
            const style = document.createElement('style');
            style.id = 'advisor-dynamic-styles';
            style.textContent = `
                /* Metric label size variants */
                .metric-label-sm {
                    font-size: 0.65rem !important;
                    line-height: 1.2;
                }
                .metric-label-xs {
                    font-size: 0.55rem !important;
                    line-height: 1.2;
                }
                
                /* Ensure metric cards have equal sizing */
                .message-rich .metric-row .metric-card {
                    flex: 1 1 0;
                    min-width: 0;
                    max-width: 200px;
                }
                
                /* Chart empty state */
                .chart-empty {
                    padding: 20px;
                    text-align: center;
                    color: #64748b;
                    font-style: italic;
                }
                
                /* Bar chart label styling */
                .bar-chart .bar-label {
                    font-size: 11px;
                    fill: #374151;
                }
                .bar-chart .bar-value {
                    font-size: 11px;
                    fill: #6b7280;
                }
                body.dark-mode .bar-chart .bar-label,
                body.dark-mode .bar-chart .bar-value {
                    fill: #d1d5db;
                }
                
                /* Fix duplicate entity step display */
                .tool-call-content .duplicate-note {
                    color: #9ca3af;
                    font-style: italic;
                    font-size: 0.85em;
                }
                
                /* ═══════════════════════════════════════════════════════════════
                   TABLE STYLES - Scroll, Grand Total, Group Headers
                   ═══════════════════════════════════════════════════════════════ */
                
                /* Horizontal scroll for wide tables */
                .table-scroll-wrapper {
                    overflow-x: auto;
                    max-width: 100%;
                    -webkit-overflow-scrolling: touch;
                }
                
                .table-scroll-wrapper::-webkit-scrollbar {
                    height: 8px;
                }
                
                .table-scroll-wrapper::-webkit-scrollbar-track {
                    background: #f1f5f9;
                    border-radius: 4px;
                }
                
                .table-scroll-wrapper::-webkit-scrollbar-thumb {
                    background: #cbd5e1;
                    border-radius: 4px;
                }
                
                body.dark-mode .table-scroll-wrapper::-webkit-scrollbar-track {
                    background: #1e293b;
                }
                
                body.dark-mode .table-scroll-wrapper::-webkit-scrollbar-thumb {
                    background: #475569;
                }
                
                /* Advisor table wrapper horizontal scroll */
                .advisor-table-wrapper {
                    overflow-x: auto;
                    max-width: 100%;
                    -webkit-overflow-scrolling: touch;
                }
                
                /* Grand Total Row - Light Mode */
                .grand-total-row {
                    background: #334155 !important;
                    color: white !important;
                    font-weight: 600 !important;
                }
                
                .grand-total-row td {
                    background: #334155 !important;
                    color: white !important;
                    border-color: #475569 !important;
                }
                
                /* Grand Total Row - Dark Mode */
                body.dark-mode .grand-total-row {
                    background: #0f172a !important;
                    color: #f1f5f9 !important;
                }
                
                body.dark-mode .grand-total-row td {
                    background: #0f172a !important;
                    color: #f1f5f9 !important;
                    border-color: #334155 !important;
                }
                
                /* Group Header Row - Light Mode */
                .group-header {
                    background: #f1f5f9 !important;
                    cursor: pointer;
                }
                
                .group-header td {
                    background: #f1f5f9 !important;
                    color: #1e293b !important;
                    font-weight: 600;
                    padding: 10px !important;
                }
                
                .group-header .group-count,
                .group-header span[style*="color: #64748b"] {
                    color: #64748b !important;
                }
                
                /* Group Header Row - Dark Mode */
                body.dark-mode .group-header {
                    background: #1e293b !important;
                }
                
                body.dark-mode .group-header td {
                    background: #1e293b !important;
                    color: #f1f5f9 !important;
                }
                
                body.dark-mode .group-header .group-count,
                body.dark-mode .group-header span[style*="color: #64748b"] {
                    color: #94a3b8 !important;
                }
                
                /* Collapsed group header chevron rotation */
                .group-header.collapsed .chevron,
                .group-header.collapsed i.fa-chevron-down {
                    transform: rotate(-90deg);
                }
                
                /* Subtotal row styling */
                .subtotal-row {
                    background: #f8fafc !important;
                    font-style: italic;
                    border-top: 1px solid #e2e8f0;
                }
                
                body.dark-mode .subtotal-row {
                    background: #0f172a !important;
                    border-top-color: #334155;
                }
                
                /* Calculated total rows (Gross Profit, Net Income) */
                .calculated-total-row {
                    background: #e2e8f0 !important;
                    font-weight: 600;
                }
                
                .calculated-total-row.grand {
                    background: #334155 !important;
                    color: white !important;
                }
                
                body.dark-mode .calculated-total-row {
                    background: #1e293b !important;
                }
                
                body.dark-mode .calculated-total-row.grand {
                    background: #0f172a !important;
                    color: #f1f5f9 !important;
                }
                
                /* Show More button for truncated tables */
                .show-more-row {
                    background: #f8fafc !important;
                }
                
                .show-more-btn {
                    background: #e2e8f0;
                    border: 1px solid #cbd5e1;
                    border-radius: 6px;
                    padding: 8px 16px;
                    font-size: 13px;
                    color: #475569;
                    cursor: pointer;
                    transition: all 0.15s ease;
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                }
                
                .show-more-btn:hover {
                    background: #cbd5e1;
                    color: #1e293b;
                }
                
                .show-more-btn i {
                    font-size: 11px;
                }
                
                body.dark-mode .show-more-row {
                    background: #1e293b !important;
                }
                
                body.dark-mode .show-more-btn {
                    background: #334155;
                    border-color: #475569;
                    color: #94a3b8;
                }
                
                body.dark-mode .show-more-btn:hover {
                    background: #475569;
                    color: #f1f5f9;
                }
                
                /* ═══════════════════════════════════════════════════════════════════
                   FINANCIAL STATEMENT STYLES (Income Statement, Balance Sheet)
                   ═══════════════════════════════════════════════════════════════════ */
                
                .financial-statement-container {
                    background: white;
                    border: 1px solid #e2e8f0;
                    border-radius: 8px;
                    overflow: hidden;
                    margin: 16px 0;
                }
                
                body.dark-mode .financial-statement-container {
                    background: #1e293b;
                    border-color: #334155;
                }
                
                /* Statement Header */
                .fs-header {
                    text-align: center;
                    padding: 20px 24px 16px;
                    border-bottom: 2px solid #cbd5e1;
                    background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
                }
                
                body.dark-mode .fs-header {
                    background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);
                    border-color: #475569;
                }
                
                .fs-title {
                    font-size: 18px;
                    font-weight: 700;
                    color: #1e293b;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    margin-bottom: 4px;
                }
                
                body.dark-mode .fs-title {
                    color: #f1f5f9;
                }
                
                .fs-date-range {
                    font-size: 13px;
                    color: #64748b;
                    font-style: italic;
                }
                
                body.dark-mode .fs-date-range {
                    color: #94a3b8;
                }
                
                /* Financial Statement Tables */
                .income-statement,
                .balance-sheet {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 13px;
                }
                
                .income-statement thead th,
                .balance-sheet thead th {
                    background: #f8fafc;
                    padding: 12px 16px;
                    font-weight: 600;
                    color: #475569;
                    text-transform: uppercase;
                    font-size: 11px;
                    letter-spacing: 0.05em;
                    border-bottom: 2px solid #e2e8f0;
                }
                
                body.dark-mode .income-statement thead th,
                body.dark-mode .balance-sheet thead th {
                    background: #0f172a;
                    color: #94a3b8;
                    border-color: #334155;
                }
                
                /* Section Headers */
                .fs-section-header {
                    background: #f1f5f9;
                    cursor: pointer;
                    transition: background 0.15s ease;
                }
                
                .fs-section-header:hover {
                    background: #e2e8f0;
                }
                
                body.dark-mode .fs-section-header {
                    background: #334155;
                }
                
                body.dark-mode .fs-section-header:hover {
                    background: #475569;
                }
                
                .fs-section-header td {
                    padding: 10px 16px;
                    font-weight: 700;
                    color: #1e293b;
                    text-transform: uppercase;
                    font-size: 12px;
                    letter-spacing: 0.03em;
                }
                
                body.dark-mode .fs-section-header td {
                    color: #e2e8f0;
                }
                
                .fs-section-header .chevron {
                    margin-right: 8px;
                    transition: transform 0.2s ease;
                    font-size: 10px;
                    color: #64748b;
                }
                
                .fs-section-header.collapsed .chevron {
                    transform: rotate(-90deg);
                }
                
                /* Account Rows */
                .fs-account-row td {
                    padding: 8px 16px;
                    border-bottom: 1px solid #f1f5f9;
                    color: #334155;
                }
                
                body.dark-mode .fs-account-row td {
                    border-color: #334155;
                    color: #cbd5e1;
                }
                
                .fs-account-row:hover {
                    background: #f8fafc;
                }
                
                body.dark-mode .fs-account-row:hover {
                    background: #1e293b;
                }
                
                /* Section Subtotals */
                .fs-section-subtotal {
                    background: #f8fafc;
                    border-top: 1px solid #e2e8f0;
                }
                
                body.dark-mode .fs-section-subtotal {
                    background: #1e293b;
                    border-color: #475569;
                }
                
                .fs-section-subtotal td {
                    padding: 10px 16px;
                    font-weight: 600;
                    color: #1e293b;
                    font-style: italic;
                }
                
                body.dark-mode .fs-section-subtotal td {
                    color: #e2e8f0;
                }
                
                .fs-subtotal-label {
                    padding-left: 32px !important;
                }
                
                /* Calculated Rows (Gross Profit, Net Income) */
                .fs-calculated-row {
                    background: #e2e8f0;
                    border-top: 2px solid #cbd5e1;
                }
                
                body.dark-mode .fs-calculated-row {
                    background: #334155;
                    border-color: #475569;
                }
                
                .fs-calculated-row td {
                    padding: 12px 16px;
                    font-weight: 700;
                    color: #1e293b;
                }
                
                body.dark-mode .fs-calculated-row td {
                    color: #f1f5f9;
                }
                
                .fs-calculated-row.grand {
                    background: #1e293b;
                    border-top: 3px double #475569;
                }
                
                .fs-calculated-row.grand td {
                    color: white;
                    font-size: 14px;
                }
                
                body.dark-mode .fs-calculated-row.grand {
                    background: #0f172a;
                    border-color: #64748b;
                }
                
                .fs-calc-label {
                    text-transform: uppercase;
                    letter-spacing: 0.03em;
                }
                
                /* Negative Values (Parentheses) */
                .fs-negative {
                    color: #dc2626;
                }
                
                body.dark-mode .fs-negative {
                    color: #f87171;
                }
                
                
                /* ═══════════════════════════════════════════════════════════════════
                   PROFESSIONAL PAPER-STYLE FINANCIAL STATEMENTS
                   ═══════════════════════════════════════════════════════════════════ */
                
                .fs-paper {
                    background: linear-gradient(to bottom, #fefefe 0%, #fafafa 100%);
                    border: 1px solid #d1d5db;
                    border-radius: 4px;
                    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.04);
                    margin: 20px auto;
                    max-width: 700px;
                    font-family: 'Georgia', 'Times New Roman', serif;
                }
                
                body.dark-mode .fs-paper {
                    background: linear-gradient(to bottom, #1e293b 0%, #0f172a 100%);
                    border-color: #334155;
                    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
                }
                
                .fs-paper-header {
                    text-align: center;
                    padding: 32px 40px 24px;
                    border-bottom: 2px solid #1e293b;
                }
                
                body.dark-mode .fs-paper-header {
                    border-color: #94a3b8;
                }
                
                .fs-company-name {
                    font-size: 22px;
                    font-weight: 700;
                    color: #1e293b;
                    letter-spacing: 0.02em;
                    margin-bottom: 6px;
                }
                
                body.dark-mode .fs-company-name {
                    color: #f1f5f9;
                }
                
                .fs-period {
                    font-size: 14px;
                    color: #64748b;
                    font-style: italic;
                }
                
                body.dark-mode .fs-period {
                    color: #94a3b8;
                }
                
                .fs-paper-body {
                    padding: 24px 40px 32px;
                }
                
                .fs-statement-table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 14px;
                }
                
                /* Section styling */
                .fs-section {
                    border-bottom: 1px solid #e2e8f0;
                }
                
                body.dark-mode .fs-section {
                    border-color: #334155;
                }
                
                .fs-section-title td {
                    padding: 16px 0 8px;
                    font-weight: 700;
                    font-size: 13px;
                    color: #1e293b;
                    text-transform: uppercase;
                    letter-spacing: 0.04em;
                    border-bottom: 1px solid #cbd5e1;
                }
                
                body.dark-mode .fs-section-title td {
                    color: #e2e8f0;
                    border-color: #475569;
                }
                
                /* Account lines */
                .fs-account-line td {
                    padding: 6px 0;
                    color: #334155;
                }
                
                body.dark-mode .fs-account-line td {
                    color: #cbd5e1;
                }
                
                .fs-account-name {
                    padding-left: 24px !important;
                }
                
                .fs-account-amount {
                    text-align: right;
                    font-variant-numeric: tabular-nums;
                    white-space: nowrap;
                }
                
                /* Section totals */
                .fs-section-total td {
                    padding: 10px 0;
                    font-weight: 600;
                    color: #1e293b;
                }
                
                body.dark-mode .fs-section-total td {
                    color: #f1f5f9;
                }
                
                .fs-total-label {
                    padding-left: 24px !important;
                    font-style: italic;
                }
                
                .fs-total-amount {
                    text-align: right;
                    border-top: 1px solid #94a3b8;
                    font-variant-numeric: tabular-nums;
                }
                
                body.dark-mode .fs-total-amount {
                    border-color: #64748b;
                }
                
                /* Calculated rows (Gross Profit, Net Income) */
                .fs-calculated {
                    background: transparent;
                }
                
                .fs-gross-profit td {
                    padding: 14px 0;
                    font-weight: 700;
                    font-size: 15px;
                    color: #1e293b;
                    border-top: 2px solid #475569;
                    border-bottom: 2px solid #475569;
                }
                
                body.dark-mode .fs-gross-profit td {
                    color: #f1f5f9;
                    border-color: #64748b;
                }
                
                .fs-gross-profit .fs-calc-amount {
                    text-align: right;
                    font-variant-numeric: tabular-nums;
                }
                
                .fs-net-income td {
                    padding: 16px 0;
                    font-weight: 700;
                    font-size: 16px;
                    color: #1e293b;
                    border-top: 3px double #1e293b;
                }
                
                body.dark-mode .fs-net-income td {
                    color: #f1f5f9;
                    border-color: #94a3b8;
                }
                
                .fs-net-income .fs-calc-amount {
                    text-align: right;
                    font-variant-numeric: tabular-nums;
                }
                
                .fs-calc-label {
                    text-transform: uppercase;
                    letter-spacing: 0.03em;
                }
                
                .fs-calc-amount {
                    text-align: right;
                }
                
                /* Print Styles */
                @media print {
                    .financial-statement-container {
                        border: none;
                        box-shadow: none;
                    }

                    .fs-header {
                        background: white !important;
                        -webkit-print-color-adjust: exact;
                    }

                    .fs-section-header .chevron {
                        display: none;
                    }

                    .fs-section-rows {
                        display: table-row-group !important;
                    }
                }

                /* ═══════════════════════════════════════════════════════════════
                   PROGRESSIVE RENDERING STYLES
                   ═══════════════════════════════════════════════════════════════ */

                .advisor-message.progressive-loading .message-bubble {
                    min-height: 60px;
                }

                .progressive-thinking {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 8px 0;
                    background: transparent;
                }

                body.dark-mode .progressive-thinking {
                    background: transparent;
                }

                .progressive-thinking .thinking-indicator {
                    display: flex;
                    gap: 4px;
                }

                .progressive-thinking .thinking-dot {
                    width: 6px;
                    height: 6px;
                    background: #9ca3af;
                    border-radius: 50%;
                    animation: progressivePulse 1.4s ease-in-out infinite;
                }

                .progressive-thinking .thinking-dot:nth-child(2) {
                    animation-delay: 0.2s;
                }

                .progressive-thinking .thinking-dot:nth-child(3) {
                    animation-delay: 0.4s;
                }

                @keyframes progressivePulse {
                    0%, 80%, 100% {
                        transform: scale(1);
                        opacity: 0.5;
                    }
                    40% {
                        transform: scale(1.2);
                        opacity: 1;
                    }
                }

                .progressive-thinking .thinking-text {
                    font-size: 0.85rem;
                    color: #64748b;
                    font-style: italic;
                }

                body.dark-mode .progressive-thinking .thinking-text {
                    color: #94a3b8;
                }

                /* Step appear animation */
                .message-steps > div {
                    animation: stepAppear 0.3s ease-out;
                }

                @keyframes stepAppear {
                    from {
                        opacity: 0;
                        transform: translateY(8px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }

                /* Error state */
                .advisor-message.has-error .message-bubble {
                    border-left: 3px solid #ef4444;
                }
            `;
            document.head.appendChild(style);
        },
        
        /**
         * Render category buttons dynamically from queryCategories
         */
        renderCategories: function() {
            const container = document.getElementById('query-categories');
            if (!container) return;
            
            const categories = this.queryCategories;
            let html = '';

            for (const [id, cat] of Object.entries(categories)) {
                html += `
                    <button class="category-pill" data-category="${id}">
                        <i class="fas ${cat.icon}"></i>
                        <span>${this.escapeHtml(cat.name)}</span>
                    </button>
                `;
            }

            container.innerHTML = html;
        },

        /**
         * Fetch dashboard health scores from unified API endpoint
         */
        fetchDashboardScores: function() {
            const self = this;
            const container = document.getElementById('score-categories');
            const timestamp = document.getElementById('scores-timestamp');

            if (!container) return;

            // Fetch and render health scores
            API.get('dashboard_scores')
                .then(function(response) {
                    if (response && response.scores) {
                        self.renderDashboardScores(response.scores);
                        if (timestamp && response.computedAt) {
                            const date = new Date(response.computedAt);
                            timestamp.textContent = 'Updated ' + self.formatRelativeTime(date);
                        }
                    }
                })
                .catch(function(error) {
                    console.error('[Advisor] Failed to fetch dashboard scores:', error);
                    // Show error state
                    container.innerHTML = '<div class="scores-error">Unable to load health scores</div>';
                });
        },

        /**
         * Render unified score-category cards
         */
        renderDashboardScores: function(scores) {
            const container = document.getElementById('score-categories');
            if (!container) return;

            const self = this;

            // Get settings data
            const settings = (window.SettingsController && SettingsController.data) ? SettingsController.data : {};

            // Dashboard-to-category mapping
            const dashboardCategoryMap = {
                'cashflow': { category: 'cash', label: 'Cash Flow', icon: 'fa-money-bill-wave' },
                'health': { category: 'revenue', label: 'Revenue', icon: 'fa-chart-line' },
                'spendvelocity': { category: 'expenses', label: 'Expenses', icon: 'fa-receipt' },
                'burden': { category: 'profitability', label: 'Margins', icon: 'fa-balance-scale' },
                'time': { category: 'labor', label: 'Labor', icon: 'fa-user-clock' },
                'customervalue': { category: 'customers', label: 'Customers', icon: 'fa-users' },
                'vendorperformance': { category: 'vendors', label: 'Vendors', icon: 'fa-handshake' },
                'integrity': { category: 'dataquality', label: 'Data Quality', icon: 'fa-shield-alt' }
            };

            // Get configured order, names, and visibility
            const dashboardOrder = settings.dashboardOrder || Object.keys(dashboardCategoryMap);
            const configuredNames = settings.dashboardNames || {};
            const visibility = settings.dashboardVisibility || {};

            let html = '';

            // Render in configured order
            dashboardOrder.forEach(function(dashboardId) {
                const item = dashboardCategoryMap[dashboardId];
                if (!item) return; // Skip if not a health score dashboard (e.g., advisor, settings)

                // Skip if not visible in settings
                if (visibility[dashboardId] === false) return;

                const scoreData = scores[dashboardId];
                const score = scoreData ? scoreData.score : '--';
                const grade = scoreData ? scoreData.grade : '';
                const displayName = configuredNames[dashboardId] || item.label;

                html += `
                    <div class="score-category-card"
                         data-dashboard="${dashboardId}"
                         data-category="${item.category || ''}"
                         data-grade="${grade}">
                        <div class="card-icon">
                            <i class="fas ${item.icon}"></i>
                        </div>
                        <div class="card-content">
                            <span class="card-score">${score}</span>
                            <span class="card-label">${displayName}</span>
                        </div>
                        ${grade ? `<span class="card-grade">${grade}</span>` : ''}
                    </div>
                `;
            });

            container.innerHTML = html;

            // If animation already completed (ambient phase), show cards immediately
            if (GeometricAnimation.phase === 'ambient' || GeometricAnimation.phase === 'idle') {
                container.classList.add('cards-visible');
            }

            // Bind click events for score-category cards
            container.querySelectorAll('.score-category-card').forEach(function(card) {
                card.addEventListener('click', function() {
                    const category = card.getAttribute('data-category');
                    if (category) {
                        self.showCategoryQueries(category);
                    }
                });
            });

            // Also update sidebar scores if available
            this.updateSidebarScores(scores);
        },

        /**
         * Update sidebar with health scores beside each dashboard name
         */
        updateSidebarScores: function(scores) {
            const nav = document.querySelector('.gantry-nav');
            if (!nav) return;

            // Route to dashboard ID mapping
            const routeMap = {
                'health': 'health',
                'time': 'time',
                'integrity': 'integrity',
                'customervalue': 'customervalue',
                'vendorperformance': 'vendorperformance',
                'spendvelocity': 'spendvelocity',
                'cashflow': 'cashflow',
                'burden': 'burden'
            };

            Object.keys(routeMap).forEach(function(route) {
                const dashboardId = routeMap[route];
                const scoreData = scores[dashboardId];
                if (!scoreData) return;

                const navLink = nav.querySelector(`[data-route="${route}"]`);
                if (!navLink) return;

                // Remove existing score badge if present
                const existingBadge = navLink.querySelector('.nav-score-badge');
                if (existingBadge) existingBadge.remove();

                // Add score badge
                const badge = document.createElement('span');
                badge.className = 'nav-score-badge';
                badge.setAttribute('data-grade', scoreData.grade);
                badge.textContent = scoreData.score;
                navLink.appendChild(badge);
            });
        },

        /**
         * Format date as relative time (e.g., "5 min ago")
         */
        formatRelativeTime: function(date) {
            const now = new Date();
            const diffMs = now - date;
            const diffMin = Math.floor(diffMs / 60000);
            const diffHrs = Math.floor(diffMs / 3600000);

            if (diffMin < 1) return 'just now';
            if (diffMin < 60) return diffMin + ' min ago';
            if (diffHrs < 24) return diffHrs + ' hr ago';
            return date.toLocaleDateString();
        },

        /**
         * Cleanup when leaving advisor
         * Saves session state so active requests can be resumed on return
         */
        cleanup: function() {
            // Save current state including any active request
            this.saveSession();

            // Cleanup geometric animation
            GeometricAnimation.cleanup();

            // Show floating panel if it exists
            const fab = document.getElementById('advisor-fab');
            if (fab) fab.style.display = '';

            console.log('[Advisor] Cleanup complete, active request preserved:', !!activeRequest);
        },
        
        /**
         * Bind all event listeners
         */
        bindEvents: function() {
            const self = this;
            
            // Send button
            const sendBtn = document.getElementById('advisor-send-full');
            if (sendBtn) {
                sendBtn.addEventListener('click', () => self.sendMessage());
            }
            
            // Input field
            const input = document.getElementById('advisor-input-full');
            if (input) {
                // Enter to send (shift+enter for newline)
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        self.sendMessage();
                    }
                });
                
                // Auto-resize textarea
                input.addEventListener('input', () => {
                    input.style.height = 'auto';
                    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
                });
                
                // Focus input
                setTimeout(() => input.focus(), 100);
            }
            
            // Query category buttons
            document.querySelectorAll('.category-pill').forEach(btn => {
                btn.addEventListener('click', () => {
                    const categoryId = btn.getAttribute('data-category');
                    self.showCategoryQueries(categoryId);
                });
            });
            
            // Back button in query panel
            const backBtn = document.getElementById('query-panel-back');
            if (backBtn) {
                backBtn.addEventListener('click', () => self.hideCategoryQueries());
            }
            
            // Suggestion chips (legacy, keep for compatibility)
            document.querySelectorAll('.suggestion-chip').forEach(chip => {
                chip.addEventListener('click', () => {
                    const question = chip.getAttribute('data-question');
                    if (question && input) {
                        input.value = question;
                        input.style.height = 'auto';
                        self.sendMessage().then(() => {
                            input.value = '';
                            input.style.height = 'auto';
                        });
                    }
                });
            });
            
            // Clear chat button
            const clearBtn = document.getElementById('advisorClearChat');
            if (clearBtn) {
                clearBtn.addEventListener('click', () => self.clearChat());
            }

            // Stop polling button
            const stopBtn = document.getElementById('advisorStopPolling');
            if (stopBtn) {
                stopBtn.addEventListener('click', () => self.stopPolling());
            }
        },
        
        /**
         * Get settings from storage or defaults
         */
        getSettings: function() {
            try {
                const stored = localStorage.getItem('gantry_advisor_settings');
                return stored ? JSON.parse(stored) : { aiMode: 'smart' };
            } catch (e) {
                return { aiMode: 'smart' };
            }
        },
        
        /**
         * Save settings to storage
         */
        saveSettings: function(settings) {
            try {
                localStorage.setItem('gantry_advisor_settings', JSON.stringify(settings));
            } catch (e) {
                console.error('Failed to save settings', e);
            }
        },
        
        /**
         * Query categories data - 8 categories aligned with health score dashboard tiles
         * Each category maps to a dashboard: cashflow, health, spendvelocity, burden, time, customervalue, vendorperformance, integrity
         */
        queryCategories: {
            // ═══════════════════════════════════════════════════════════════════
            // CASH FLOW - Dashboard: cashflow
            // ═══════════════════════════════════════════════════════════════════
            cash: {
                name: 'Cash Flow',
                icon: 'fa-money-bill-wave',
                color: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                queries: [
                    { text: 'Cash Position', question: "What's our current cash position?" },
                    { text: 'Cash Runway', question: 'How many weeks of runway do we have?' },
                    { text: 'Burn Rate', question: "What's our weekly burn rate?" },
                    { text: 'Cash Forecast', question: 'What will our cash be in 30 days?' },
                    { text: 'Critical Weeks', question: 'When might we face cash constraints?' },
                    { text: 'Bank Balances', question: 'Show all bank account balances' },
                    { text: 'Working Capital', question: "What's our working capital position?" },
                    { text: 'AR/AP Impact', question: 'How do AR and AP affect our cash flow?' }
                ]
            },
            // ═══════════════════════════════════════════════════════════════════
            // REVENUE - Dashboard: health (P&L)
            // Absorbs: financials (income statement, balance sheet, trial balance)
            // ═══════════════════════════════════════════════════════════════════
            revenue: {
                name: 'Revenue',
                icon: 'fa-chart-line',
                color: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                queries: [
                    { text: 'Health Score', question: "What's our financial health score?" },
                    { text: 'Income Statement', question: 'Show the full income statement' },
                    { text: 'Balance Sheet', question: 'Show balance sheet' },
                    { text: 'P&L Summary', question: 'Show P&L summary year to date' },
                    { text: 'Gross Margin', question: "What's our gross margin?" },
                    { text: 'YoY Comparison', question: 'How does this year compare to last year?' },
                    { text: 'Department P&L', question: 'Show P&L for ', prefill: true, placeholder: 'Enter department name' },
                    { text: 'Monthly Trend', question: 'Show monthly revenue trend' }
                ]
            },
            // ═══════════════════════════════════════════════════════════════════
            // EXPENSES - Dashboard: spendvelocity
            // ═══════════════════════════════════════════════════════════════════
            expenses: {
                name: 'Expenses',
                icon: 'fa-receipt',
                color: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
                queries: [
                    { text: 'Spend Health', question: "What's our spend health score?" },
                    { text: 'Expense Breakdown', question: 'Break down expenses by category YTD' },
                    { text: 'Spend Velocity', question: 'Which vendors have accelerating spend?' },
                    { text: 'Subscription Creep', question: 'Are there boiling frog spending patterns?' },
                    { text: 'Shadow IT', question: 'Are there shadow IT tools spreading?' },
                    { text: 'Anomalies', question: 'Which expense accounts show anomalies?' },
                    { text: 'By Department', question: 'Show expenses by department' },
                    { text: 'Monthly Trend', question: 'Show monthly expense trend' }
                ]
            },
            // ═══════════════════════════════════════════════════════════════════
            // MARGINS - Dashboard: burden
            // Absorbs: gl (GL activity, journal entries)
            // ═══════════════════════════════════════════════════════════════════
            profitability: {
                name: 'Margins',
                icon: 'fa-balance-scale',
                color: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                queries: [
                    { text: 'Burden Rate', question: "What's our current burden rate?" },
                    { text: 'vs Target', question: 'How does burden compare to our target?' },
                    { text: 'Overhead Breakdown', question: 'Show overhead costs by category' },
                    { text: 'Department Burden', question: 'Which departments have highest burden?' },
                    { text: 'Gross Margin', question: 'Show gross margin by department' },
                    { text: 'Net Margin', question: "What's our net profit margin?" },
                    { text: 'GL Activity', question: 'Show GL activity for ', prefill: true, placeholder: 'Enter account name' },
                    { text: 'Journal Entries', question: 'Show recent journal entries' }
                ]
            },
            // ═══════════════════════════════════════════════════════════════════
            // LABOR - Dashboard: time
            // ═══════════════════════════════════════════════════════════════════
            labor: {
                name: 'Labor',
                icon: 'fa-user-clock',
                color: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                queries: [
                    { text: 'Utilization', question: "What's our team utilization rate?" },
                    { text: 'By Employee', question: 'Show utilization by employee' },
                    { text: 'Unbilled Time', question: 'How much unbilled time do we have?' },
                    { text: 'Effective Rate', question: "What's our effective billing rate?" },
                    { text: 'By Customer', question: 'Which customers consume the most time?' },
                    { text: 'Billable Hours', question: 'Show billable hours this month' },
                    { text: 'Monthly Trend', question: 'Show utilization trend by month' },
                    { text: 'Non-Billable', question: 'Where is non-billable time going?' }
                ]
            },
            // ═══════════════════════════════════════════════════════════════════
            // CUSTOMERS - Dashboard: customervalue
            // Absorbs: ar (AR aging, DSO, customer payments)
            // ═══════════════════════════════════════════════════════════════════
            customers: {
                name: 'Customers',
                icon: 'fa-users',
                color: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)',
                queries: [
                    { text: 'Customer Score', question: "What's our customer intelligence score?" },
                    { text: 'Churn Risk', question: 'Which customers are at risk of churning?' },
                    { text: 'Lifetime Value', question: "What's our customer lifetime value?" },
                    { text: 'Top Customers', question: 'Who are our top 10 customers?' },
                    { text: 'AR Aging', question: 'Show AR aging summary' },
                    { text: 'Past Due AR', question: 'Which invoices are past due?' },
                    { text: 'DSO', question: "What's our days sales outstanding?" },
                    { text: 'Customer Payments', question: 'Show recent customer payments' }
                ]
            },
            // ═══════════════════════════════════════════════════════════════════
            // VENDORS - Dashboard: vendorperformance
            // Absorbs: ap (AP aging, DPO, bills due)
            // ═══════════════════════════════════════════════════════════════════
            vendors: {
                name: 'Vendors',
                icon: 'fa-handshake',
                color: 'linear-gradient(135deg, #ec4899 0%, #db2777 100%)',
                queries: [
                    { text: 'Vendor Score', question: "What's our vendor performance score?" },
                    { text: 'Renewal Radar', question: 'Which vendors are due for renewal?' },
                    { text: 'Maverick Spend', question: 'Do we have spend without purchase orders?' },
                    { text: 'Top Vendors', question: 'Who are our top vendors by spend?' },
                    { text: 'AP Aging', question: 'Show AP aging summary' },
                    { text: 'Bills Due', question: 'What bills are due this week?' },
                    { text: 'DPO', question: "What's our days payable outstanding?" },
                    { text: 'Past Due Bills', question: 'Which bills are past due?' }
                ]
            },
            // ═══════════════════════════════════════════════════════════════════
            // DATA QUALITY - Dashboard: integrity (Sentinel)
            // Absorbs: transactions (find invoice/bill/SO/PO)
            // ═══════════════════════════════════════════════════════════════════
            dataquality: {
                name: 'Data Quality',
                icon: 'fa-shield-alt',
                color: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                queries: [
                    { text: 'Risk Score', question: 'What is our transaction risk score?' },
                    { text: 'Flagged Items', question: 'Show flagged transactions this month' },
                    { text: 'Duplicates', question: 'Are there potential duplicate bills?' },
                    { text: "Benford's Law", question: "Which transactions fail Benford's Law?" },
                    { text: 'Find Invoice', question: 'Find invoice #', prefill: true, placeholder: 'Enter invoice number' },
                    { text: 'Find Bill', question: 'Find vendor bill #', prefill: true, placeholder: 'Enter bill number' },
                    { text: 'Find SO/PO', question: 'Find sales order #', prefill: true, placeholder: 'Enter SO or PO number' },
                    { text: 'Latest Activity', question: 'Show transactions created today' }
                ]
            }
        },
        
        /**
         * Show queries for a category
         */
        showCategoryQueries: function(categoryId) {
            const category = this.queryCategories[categoryId];
            if (!category) return;

            const scoreCategoriesEl = document.getElementById('score-categories');
            const panelEl = document.getElementById('query-panel');
            const iconEl = document.getElementById('query-panel-icon');
            const titleEl = document.getElementById('query-panel-title');
            const gridEl = document.getElementById('query-panel-grid');

            if (!panelEl) return;
            
            // Update panel header
            iconEl.style.background = category.color;
            iconEl.innerHTML = `<i class="fas ${category.icon}"></i>`;
            titleEl.textContent = category.name;
            
            // Build query buttons
            gridEl.innerHTML = category.queries.map(q => {
                const prefillAttr = q.prefill ? 'data-prefill="true"' : '';
                const icon = q.prefill ? 'fa-pen' : 'fa-arrow-right';
                return `
                    <button class="query-panel-item ${q.prefill ? 'prefill-mode' : ''}" 
                            data-question="${this.escapeHtml(q.question)}" 
                            ${prefillAttr}>
                        <span>${this.escapeHtml(q.text)}</span>
                        <i class="fas ${icon}"></i>
                    </button>
                `;
            }).join('');
            
            // Bind click handlers
            const self = this;
            const input = document.getElementById('advisor-input-full');
            gridEl.querySelectorAll('.query-panel-item').forEach(item => {
                item.addEventListener('click', () => {
                    const question = item.getAttribute('data-question');
                    const isPrefill = item.getAttribute('data-prefill') === 'true';
                    
                    if (question && input) {
                        input.value = question;
                        
                        if (isPrefill) {
                            // Just prefill and focus - don't send
                            self.hideCategoryQueries();
                            input.focus();
                            // Position cursor at end
                            input.setSelectionRange(input.value.length, input.value.length);
                        } else {
                            // Auto-send
                            self.sendMessage().then(() => {
                                input.value = '';
                                input.style.height = 'auto';
                            });
                        }
                    }
                });
            });
            
            // Show panel, hide score-categories
            if (scoreCategoriesEl) scoreCategoriesEl.classList.add('panel-open');
            panelEl.classList.add('visible');
        },

        /**
         * Hide category queries, show categories
         */
        hideCategoryQueries: function() {
            const scoreCategoriesEl = document.getElementById('score-categories');
            const panelEl = document.getElementById('query-panel');

            if (panelEl) {
                panelEl.classList.remove('visible');
            }
            if (scoreCategoriesEl) {
                scoreCategoriesEl.classList.remove('panel-open');
            }
        },
        
        /**
         * Send a message to the advisor
         * Uses polling-based progressive rendering for real-time step updates
         */
        sendMessage: async function() {
            const input = document.getElementById('advisor-input-full');
            const text = input ? input.value.trim() : '';

            if (!text || isProcessing) return;

            // Store for retry functionality
            this.lastUserMessage = text;

            // Clear input and follow-up suggestions
            input.value = '';
            input.style.height = 'auto';
            this.clearFollowUpSuggestions();

            // Hide health scores with animation
            const healthScores = document.getElementById('health-scores-overview');
            if (healthScores) healthScores.classList.add('hidden');

            // Trigger geometric animation departure (fade out)
            GeometricAnimation.startDeparture();

            // Hide welcome
            const welcome = document.getElementById('advisor-welcome-full');
            if (welcome) welcome.style.display = 'none';

            // Add user message
            this.addMessage('user', text);

            isProcessing = true;
            this.updateSendButton(true);

            try {
                // Build history for API
                const history = messages
                    .filter(m => m.role !== 'thinking')
                    .slice(-MAX_HISTORY)
                    .map(m => ({ role: m.role, content: m.content }));

                // Get AI mode settings
                const settings = this.getSettings();
                const aiSettings = {
                    mode: settings.aiMode || 'smart',
                    customProvider: settings.customProvider || 'gemini',
                    tier1Model: settings.tier1Model,
                    tier2Model: settings.tier2Model,
                    tier3Model: settings.tier3Model,
                    debugMode: settings.debugMode || false
                };

                // Use progressive rendering with polling
                await this.sendMessageWithPolling(text, history, aiSettings);

            } catch (err) {
                console.error('[Advisor] Error:', err);
                // Error is already handled by updateProgressiveMessageError in sendMessageWithPolling
                // Don't add another error message - just log it
            } finally {
                isProcessing = false;
                this.updateSendButton(false);
            }
        },

        /**
         * Send message with polling-based progressive rendering
         * Creates a placeholder message and updates it as steps come in
         */
        sendMessageWithPolling: async function(text, history, aiSettings) {
            const POLL_INTERVAL = 500; // Poll every 500ms
            const MAX_POLL_TIME = 120000; // Max 2 minutes

            // Create progressive message placeholder
            const progressiveMsgId = this.createProgressiveMessage();

            try {
                // Start async processing
                const startResponse = await API.post('advisor_chat_async', {
                    message: text,
                    history: history,
                    context: { dashboard: 'advisor' },
                    aiSettings: aiSettings,
                    sessionContext: sessionContext
                });

                if (!startResponse.request_id) {
                    throw new Error('No request_id returned from async endpoint');
                }

                const requestId = startResponse.request_id;
                let lastStepCount = 0;
                const startTime = Date.now();
                let consecutiveErrors = 0;
                const MAX_CONSECUTIVE_ERRORS = 5;

                // Set unique polling ID to detect if another loop takes over
                const myPollingId = 'poll-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
                currentPollingId = myPollingId;

                // Store active request for resume on navigation
                activeRequest = {
                    requestId: requestId,
                    userMessage: text,
                    startTime: startTime,
                    lastStepCount: 0,
                    steps: [],
                    aiSettings: aiSettings
                };
                this.saveSession();

                // Poll for updates
                while (true) {
                    // Check if this polling loop has been superseded by another (e.g., resumed after navigation)
                    if (currentPollingId !== myPollingId) {
                        console.log('[Advisor Polling] Polling loop superseded by newer instance, exiting');
                        return;
                    }

                    // Check timeout
                    if (Date.now() - startTime > MAX_POLL_TIME) {
                        throw new Error('Request timed out');
                    }

                    // Get status with error handling for transient failures
                    let status;
                    try {
                        status = await API.get('advisor_status', { id: requestId });
                        consecutiveErrors = 0; // Reset on success
                    } catch (pollErr) {
                        consecutiveErrors++;
                        console.warn('[Advisor Polling] API error, attempt ' + consecutiveErrors + '/' + MAX_CONSECUTIVE_ERRORS, pollErr.message);
                        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                            throw new Error('Failed after ' + MAX_CONSECUTIVE_ERRORS + ' consecutive errors: ' + pollErr.message);
                        }
                        await this.sleep(POLL_INTERVAL);
                        continue;
                    }

                    console.log('[Advisor Polling]', {
                        status: status.status,
                        stepCount: status.steps ? status.steps.length : 0,
                        lastStepCount: lastStepCount,
                        hasNewSteps: status.steps && status.steps.length > lastStepCount
                    });

                    // Update steps progressively
                    if (status.steps && status.steps.length > lastStepCount) {
                        const newSteps = status.steps.slice(lastStepCount);
                        console.log('[Advisor Polling] Appending new steps:', newSteps.length, newSteps.map(s => s.title));
                        this.appendStepsToProgressiveMessage(progressiveMsgId, newSteps);
                        lastStepCount = status.steps.length;

                        // Update active request state for resume
                        if (activeRequest && activeRequest.requestId === requestId) {
                            activeRequest.lastStepCount = lastStepCount;
                            activeRequest.steps = status.steps;
                            this.saveSession();
                        }
                    }

                    // Render progressive blocks (tables, metrics) immediately
                    if (status.blocks && status.blocks.length > 0) {
                        this.updateProgressiveMessageBlocks(progressiveMsgId, status.blocks);
                    }

                    // Check if complete
                    if (status.status === 'complete') {
                        // Clear active request before finalizing
                        activeRequest = null;
                        this.saveSession();

                        // Finalize the message with answer and rich content
                        this.finalizeProgressiveMessage(progressiveMsgId, {
                            text: status.answer,
                            richContent: status.richContent,
                            steps: status.steps,
                            sessionContext: status.sessionContext,
                            model: status.model,
                            provider: status.provider,
                            duration: status.totalDuration
                        });

                        // Update session context if provided
                        if (status.sessionContext) {
                            sessionContext = { ...sessionContext, ...status.sessionContext };
                        }
                        break;
                    }

                    // Check for error
                    if (status.status === 'error') {
                        throw new Error(status.error || 'Unknown error during processing');
                    }

                    // Check for not found
                    if (status.status === 'not_found') {
                        throw new Error('Request expired or not found');
                    }

                    // Wait before next poll
                    await this.sleep(POLL_INTERVAL);
                }

            } catch (err) {
                // Clear active request on error
                activeRequest = null;
                this.saveSession();

                // Update progressive message with error
                this.updateProgressiveMessageError(progressiveMsgId, err.message);
                throw err;
            }
        },

        /**
         * Resume an active request after navigating back to advisor
         * Recreates the progressive message UI and continues polling
         */
        resumeActiveRequest: async function(savedRequest) {
            const POLL_INTERVAL = 500;
            const MAX_POLL_TIME = 120000;

            console.log('[Advisor] Resuming active request:', savedRequest.requestId);

            // Set new polling ID - this will cause any old polling loop to exit
            const myPollingId = 'resume-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
            currentPollingId = myPollingId;

            isProcessing = true;
            this.updateSendButton(true);

            // Create new progressive message placeholder
            const progressiveMsgId = this.createProgressiveMessage();

            // Render any steps we already received before navigating away
            if (savedRequest.steps && savedRequest.steps.length > 0) {
                console.log('[Advisor] Restoring', savedRequest.steps.length, 'previous steps');
                this.appendStepsToProgressiveMessage(progressiveMsgId, savedRequest.steps);
            }

            let lastStepCount = savedRequest.lastStepCount || 0;
            const requestId = savedRequest.requestId;
            const startTime = savedRequest.startTime;
            let consecutiveErrors = 0;
            const MAX_CONSECUTIVE_ERRORS = 5;

            try {
                // Resume polling
                while (true) {
                    // Check if this polling loop has been superseded
                    if (currentPollingId !== myPollingId) {
                        console.log('[Advisor Resume Polling] Polling loop superseded, exiting');
                        return;
                    }

                    // Check overall timeout from original start time
                    if (Date.now() - startTime > MAX_POLL_TIME) {
                        throw new Error('Request timed out');
                    }

                    // Get status
                    let status;
                    try {
                        status = await API.get('advisor_status', { id: requestId });
                        consecutiveErrors = 0;
                    } catch (pollErr) {
                        consecutiveErrors++;
                        console.warn('[Advisor Resume Polling] API error, attempt ' + consecutiveErrors + '/' + MAX_CONSECUTIVE_ERRORS, pollErr.message);
                        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                            throw new Error('Failed after ' + MAX_CONSECUTIVE_ERRORS + ' consecutive errors: ' + pollErr.message);
                        }
                        await this.sleep(POLL_INTERVAL);
                        continue;
                    }

                    console.log('[Advisor Resume Polling]', {
                        status: status.status,
                        stepCount: status.steps ? status.steps.length : 0,
                        lastStepCount: lastStepCount
                    });

                    // Update steps progressively (only new ones since last seen)
                    if (status.steps && status.steps.length > lastStepCount) {
                        const newSteps = status.steps.slice(lastStepCount);
                        console.log('[Advisor Resume Polling] Appending new steps:', newSteps.length);
                        this.appendStepsToProgressiveMessage(progressiveMsgId, newSteps);
                        lastStepCount = status.steps.length;

                        // Update active request state
                        if (activeRequest && activeRequest.requestId === requestId) {
                            activeRequest.lastStepCount = lastStepCount;
                            activeRequest.steps = status.steps;
                            this.saveSession();
                        }
                    }

                    // Render progressive blocks (tables, metrics) immediately
                    if (status.blocks && status.blocks.length > 0) {
                        this.updateProgressiveMessageBlocks(progressiveMsgId, status.blocks);
                    }

                    // Check if complete
                    if (status.status === 'complete') {
                        // Clear active request
                        activeRequest = null;
                        this.saveSession();

                        // Finalize the message
                        this.finalizeProgressiveMessage(progressiveMsgId, {
                            text: status.answer,
                            richContent: status.richContent,
                            steps: status.steps,
                            sessionContext: status.sessionContext,
                            model: status.model,
                            provider: status.provider,
                            duration: status.totalDuration
                        });

                        // Update session context if provided
                        if (status.sessionContext) {
                            sessionContext = { ...sessionContext, ...status.sessionContext };
                        }
                        break;
                    }

                    // Check for error
                    if (status.status === 'error') {
                        throw new Error(status.error || 'Unknown error during processing');
                    }

                    // Check for not found (request expired on server)
                    if (status.status === 'not_found') {
                        throw new Error('Request expired or not found. Please try your question again.');
                    }

                    await this.sleep(POLL_INTERVAL);
                }

            } catch (err) {
                // Clear active request on error
                activeRequest = null;
                this.saveSession();

                this.updateProgressiveMessageError(progressiveMsgId, err.message);
                console.error('[Advisor Resume] Error:', err);
            } finally {
                isProcessing = false;
                this.updateSendButton(false);
            }
        },

        /**
         * Create a progressive message placeholder
         */
        createProgressiveMessage: function() {
            const container = document.getElementById('advisor-messages-full');
            if (!container) return null;

            const msgId = 'progressive-msg-' + Date.now();

            const div = document.createElement('div');
            div.id = msgId;
            div.className = 'advisor-message assistant progressive-loading';
            div.innerHTML = `
                <div class="message-bubble">
                    <div class="message-steps" id="${msgId}-steps">
                        <div class="progressive-thinking">
                            <div class="thinking-node-indicator">
                                <div class="thinking-node-core">
                                    <i class="fas fa-brain"></i>
                                </div>
                                <div class="thinking-node-ring"></div>
                                <div class="thinking-node-ring delay"></div>
                            </div>
                        </div>
                    </div>
                    <div class="message-content" id="${msgId}-content" style="display: none;"></div>
                    <div class="message-rich" id="${msgId}-rich" style="display: none;"></div>
                </div>
            `;

            container.appendChild(div);
            this.scrollToBottom();

            return msgId;
        },

        /**
         * Append steps to a progressive message using Neural Flow thought-chain
         * Includes retry mechanism for race condition when DOM hasn't rendered yet
         */
        appendStepsToProgressiveMessage: function(msgId, steps, retryCount) {
            retryCount = retryCount || 0;
            const MAX_RETRIES = 5;

            console.log('[Advisor appendSteps] msgId:', msgId, 'steps:', steps.length, 'retry:', retryCount);
            const stepsContainer = document.getElementById(msgId + '-steps');
            if (!stepsContainer) {
                if (retryCount < MAX_RETRIES) {
                    console.log('[Advisor appendSteps] Container NOT FOUND, scheduling retry:', msgId + '-steps');
                    const self = this;
                    requestAnimationFrame(function() {
                        setTimeout(function() {
                            self.appendStepsToProgressiveMessage(msgId, steps, retryCount + 1);
                        }, 50);
                    });
                } else {
                    console.error('[Advisor appendSteps] Container NOT FOUND after max retries:', msgId + '-steps');
                }
                return;
            }
            console.log('[Advisor appendSteps] Container found:', stepsContainer);

            // Remove thinking indicator if present
            const thinking = stepsContainer.querySelector('.progressive-thinking');
            if (thinking) {
                console.log('[Advisor appendSteps] Removing thinking indicator');
                thinking.remove();
            }

            // Check if the message is still loading (show pending indicator)
            const msgEl = document.getElementById(msgId);
            const isStillLoading = msgEl && msgEl.classList.contains('progressive-loading');

            // Check if we already have a thought-chain
            let existingChain = stepsContainer.querySelector('.thought-chain');

            if (existingChain) {
                // Incremental update: only modify what changed, append new steps
                const existingSteps = existingChain._stepsData || [];
                const chainId = existingChain.getAttribute('data-chain-id');
                const nodesContainer = existingChain.querySelector('.thought-nodes');
                const existingNodes = nodesContainer.querySelectorAll('.thought-node');

                let hasChanges = false;
                const statusChanges = []; // Track which existing nodes need status updates
                const newSteps = []; // Track genuinely new steps to append

                // Categorize incoming steps
                steps.forEach(step => {
                    const existingIdx = existingSteps.findIndex(s =>
                        s.title === step.title && s.type === step.type
                    );
                    if (existingIdx < 0) {
                        // Genuinely new step
                        newSteps.push(step);
                        hasChanges = true;
                    } else if (existingSteps[existingIdx].status !== step.status) {
                        // Status changed on existing step
                        statusChanges.push({ idx: existingIdx, step: step });
                        existingSteps[existingIdx] = step;
                        hasChanges = true;
                    }
                });

                // Skip if nothing changed
                if (!hasChanges) {
                    console.log('[Advisor appendSteps] No changes detected, skipping update');
                    return;
                }

                // 1. Update status on existing nodes (in-place, no re-render)
                statusChanges.forEach(({ idx, step }) => {
                    const node = existingNodes[idx];
                    if (!node) return;

                    const newStatus = this.normalizeStepStatus(step.status);
                    const oldStatus = node.classList.contains('running') ? 'running' :
                                     node.classList.contains('complete') ? 'complete' :
                                     node.classList.contains('error') ? 'error' : 'pending';

                    if (newStatus !== oldStatus) {
                        // Update node status class
                        node.classList.remove('running', 'complete', 'error', 'pending');
                        node.classList.add(newStatus);

                        // Handle orbital dots (only present when running)
                        const orbitalDots = node.querySelector('.orbital-dots');
                        if (newStatus === 'running' && !orbitalDots) {
                            const dots = document.createElement('div');
                            dots.className = 'orbital-dots';
                            dots.innerHTML = '<span></span><span></span><span></span>';
                            node.querySelector('.node-ring').after(dots);
                        } else if (newStatus !== 'running' && orbitalDots) {
                            orbitalDots.remove();
                        }

                        // Update tooltip status
                        const tooltipStatus = node.querySelector('.tooltip-status');
                        if (tooltipStatus) {
                            tooltipStatus.classList.remove('running', 'complete', 'error', 'pending');
                            tooltipStatus.classList.add(newStatus);
                            tooltipStatus.textContent = newStatus;
                        }

                        // Update connector before this node
                        if (idx > 0) {
                            const connectors = nodesContainer.querySelectorAll('.node-connector');
                            const connector = connectors[idx - 1];
                            if (connector) {
                                connector.classList.remove('active', 'completed');
                                connector.classList.add(newStatus === 'running' ? 'active' : 'completed');
                            }
                        }
                    }
                });

                // 2. Remove pending indicator and thinking trail before appending
                const pendingIndicator = nodesContainer.querySelector('.thinking-node-indicator');
                const pendingConnector = pendingIndicator ? pendingIndicator.previousElementSibling : null;
                if (pendingIndicator) pendingIndicator.remove();
                if (pendingConnector && pendingConnector.classList.contains('node-connector')) pendingConnector.remove();

                const thinkingTrail = nodesContainer.querySelector('.thinking-trail');
                if (thinkingTrail) thinkingTrail.remove();

                // 3. Append new steps
                newSteps.forEach(step => {
                    const newIdx = existingSteps.length;
                    existingSteps.push(step);

                    // Add connector
                    const connectorStatus = this.normalizeStepStatus(step.status) === 'running' ? 'active' : 'completed';
                    const connectorHtml = `<div class="node-connector ${connectorStatus} animate-in cascade-delay-${newIdx}" style="--flow-delay: ${newIdx * 0.3}s"></div>`;
                    nodesContainer.insertAdjacentHTML('beforeend', connectorHtml);

                    // Add node
                    const isFinal = !isStillLoading && newSteps.indexOf(step) === newSteps.length - 1;
                    const nodeHtml = this.renderThoughtNode(step, newIdx, chainId, isFinal);
                    nodesContainer.insertAdjacentHTML('beforeend', nodeHtml);
                });

                // 4. Re-add pending indicator if still loading
                const hasRunning = existingSteps.some(s => this.normalizeStepStatus(s.status) === 'running');
                if (isStillLoading && !hasRunning) {
                    const lastIdx = existingSteps.length;
                    const pendingHtml = `
                        <div class="node-connector active animate-in cascade-delay-${lastIdx}" style="--flow-delay: ${lastIdx * 0.3}s"></div>
                        <div class="thinking-node-indicator inline">
                            <div class="thinking-node-core"><i class="fas fa-brain"></i></div>
                            <div class="thinking-node-ring"></div>
                        </div>
                    `;
                    nodesContainer.insertAdjacentHTML('beforeend', pendingHtml);
                }

                // 5. Add thinking trail if there's a running step
                if (hasRunning) {
                    nodesContainer.insertAdjacentHTML('beforeend', '<div class="thinking-trail"><span></span><span></span><span></span></div>');
                }

                // 6. Update chain-complete class
                const allComplete = existingSteps.every(s => this.normalizeStepStatus(s.status) === 'complete') && !isStillLoading;
                existingChain.classList.toggle('chain-complete', allComplete);

                // 7. Update stored step data
                existingChain._stepsData = existingSteps.map(s => ({...s, _chainId: chainId}));

            } else {
                // Create new thought-chain with pending indicator if still loading
                const chainHtml = this.renderSteps(steps, isStillLoading);
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = chainHtml;
                const newChain = tempDiv.firstElementChild;

                if (newChain) {
                    // Store step data on the chain element for expansion
                    newChain._stepsData = steps.map((s, i) => ({...s, _chainId: newChain.getAttribute('data-chain-id')}));
                    stepsContainer.appendChild(newChain);
                }
            }

            this.scrollToBottom();
        },

        /**
         * Finalize a progressive message with the final response
         * Includes retry mechanism for race condition when DOM hasn't rendered yet
         */
        finalizeProgressiveMessage: function(msgId, response, retryCount) {
            retryCount = retryCount || 0;
            const MAX_RETRIES = 5;

            const msgEl = document.getElementById(msgId);
            if (!msgEl) {
                if (retryCount < MAX_RETRIES) {
                    console.log('[Advisor finalizeMessage] Container NOT FOUND, scheduling retry:', msgId);
                    const self = this;
                    requestAnimationFrame(function() {
                        setTimeout(function() {
                            self.finalizeProgressiveMessage(msgId, response, retryCount + 1);
                        }, 50);
                    });
                } else {
                    console.error('[Advisor finalizeMessage] Container NOT FOUND after max retries:', msgId);
                }
                return;
            }

            // Remove loading state
            msgEl.classList.remove('progressive-loading');

            // Remove thinking indicator if still present
            const stepsContainer = document.getElementById(msgId + '-steps');
            if (stepsContainer) {
                const thinking = stepsContainer.querySelector('.progressive-thinking');
                if (thinking) thinking.remove();

                // Finalize the thought chain with incremental updates (no full re-render)
                const existingChain = stepsContainer.querySelector('.thought-chain');
                if (existingChain) {
                    const nodesContainer = existingChain.querySelector('.thought-nodes');

                    // Remove pending indicator and thinking trail
                    const pendingIndicator = nodesContainer.querySelector('.thinking-node-indicator');
                    const pendingConnector = pendingIndicator ? pendingIndicator.previousElementSibling : null;
                    if (pendingIndicator) pendingIndicator.remove();
                    if (pendingConnector && pendingConnector.classList.contains('node-connector')) pendingConnector.remove();

                    const thinkingTrail = nodesContainer.querySelector('.thinking-trail');
                    if (thinkingTrail) thinkingTrail.remove();

                    // Mark chain as complete
                    existingChain.classList.add('chain-complete');

                    // Update final node styling
                    const nodes = nodesContainer.querySelectorAll('.thought-node');
                    nodes.forEach((node, idx) => {
                        node.classList.toggle('final', idx === nodes.length - 1);
                    });
                }
            }

            // Rich content takes priority - if we have richContent, render ALL of it (including text blocks)
            // Only fall back to response.text if no richContent exists
            const contentEl = document.getElementById(msgId + '-content');
            const richEl = document.getElementById(msgId + '-rich');
            const hasRichContent = response.richContent && response.richContent.length > 0;

            if (hasRichContent && richEl) {
                // Render ALL rich content items (text, tables, metrics, etc.)
                let richHtml = '';
                response.richContent.forEach(item => {
                    richHtml += this.renderRichContent(item);
                });
                if (richHtml) {
                    richEl.innerHTML = richHtml;
                    richEl.style.display = 'block';
                }
                // Hide text fallback since we have rich content
                if (contentEl) {
                    contentEl.style.display = 'none';
                }
            } else if (contentEl && response.text) {
                // Fallback: no rich content, show plain text
                contentEl.innerHTML = this.formatText(response.text);
                contentEl.style.display = 'block';
            }

            // Add to messages array for history
            const msg = {
                role: 'assistant',
                content: response.text || '',
                richContent: response.richContent,
                steps: response.steps,
                model: response.model || 'Gantry',
                userQuery: this.lastUserMessage || '',
                timestamp: Date.now()
            };
            messages.push(msg);
            this.saveSession();

            // Generate follow-up suggestions (if method exists)
            if (typeof this.generateFollowUpSuggestions === 'function') {
                this.generateFollowUpSuggestions(response);
            }

            // Add message footer with model badge and response actions (retry, copy, print)
            const bubble = msgEl.querySelector('.message-bubble');
            if (bubble) {
                const modelName = response.model || 'Gantry';
                const footerId = 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
                const retryQuery = this.lastUserMessage ? this.escapeHtml(this.lastUserMessage).replace(/'/g, "\\'") : '';
                const footer = document.createElement('div');
                footer.className = 'message-footer';
                footer.id = footerId;
                footer.innerHTML = `
                    <div class="model-badge">${this.escapeHtml(modelName)}</div>
                    <div class="response-actions">
                        <button class="action-btn action-btn-subtle" onclick="AdvisorChat.retryQuery('${retryQuery}')" title="Retry">
                            <i class="fas fa-redo"></i>
                        </button>
                        <button class="action-btn" onclick="AdvisorChat.copyResponse('${footerId}')" title="Copy">
                            <i class="fas fa-copy"></i>
                        </button>
                        <button class="action-btn" onclick="AdvisorChat.printResponse('${footerId}')" title="Print">
                            <i class="fas fa-print"></i>
                        </button>
                    </div>
                `;
                bubble.appendChild(footer);
            }

            this.scrollToBottom();
        },

        /**
         * Update progressive message with error
         */
        updateProgressiveMessageError: function(msgId, errorMessage) {
            const msgEl = document.getElementById(msgId);
            if (!msgEl) return;

            msgEl.classList.remove('progressive-loading');
            msgEl.classList.add('has-error');

            const stepsContainer = document.getElementById(msgId + '-steps');
            if (stepsContainer) {
                const thinking = stepsContainer.querySelector('.progressive-thinking');
                if (thinking) thinking.remove();

                // Add error step to existing chain or create new one
                const errorStep = {
                    type: 'error',
                    title: 'Error',
                    content: errorMessage,
                    status: 'error'
                };

                const existingChain = stepsContainer.querySelector('.thought-chain');
                if (existingChain && existingChain._stepsData) {
                    // Add error step to existing chain
                    const allSteps = [...existingChain._stepsData, errorStep];
                    const chainHtml = this.renderSteps(allSteps);
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = chainHtml;
                    const newChain = tempDiv.firstElementChild;
                    if (newChain) {
                        newChain._stepsData = allSteps.map((s, i) => ({...s, _chainId: newChain.getAttribute('data-chain-id')}));
                        existingChain.replaceWith(newChain);
                    }
                } else {
                    // Create new chain with just the error step
                    const chainHtml = this.renderSteps([errorStep]);
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = chainHtml;
                    const newChain = tempDiv.firstElementChild;
                    if (newChain) {
                        newChain._stepsData = [errorStep].map((s, i) => ({...s, _chainId: newChain.getAttribute('data-chain-id')}));
                        stepsContainer.appendChild(newChain);
                    }
                }
            }
        },

        /**
         * Update progressive message with blocks (tables, metrics)
         * Renders blocks immediately during processing for instant feedback
         */
        updateProgressiveMessageBlocks: function(msgId, blocks) {
            const msgEl = document.getElementById(msgId);
            if (!msgEl || !blocks || blocks.length === 0) return;

            // Find or create blocks container
            let blocksContainer = document.getElementById(msgId + '-blocks');
            if (!blocksContainer) {
                blocksContainer = document.createElement('div');
                blocksContainer.id = msgId + '-blocks';
                blocksContainer.className = 'progressive-blocks-container';

                // Insert after steps but before any existing content
                const stepsContainer = document.getElementById(msgId + '-steps');
                const bubble = msgEl.querySelector('.advisor-message-bubble');
                if (bubble && stepsContainer) {
                    stepsContainer.after(blocksContainer);
                } else if (bubble) {
                    bubble.appendChild(blocksContainer);
                }
            }

            // Track which blocks we've already rendered
            if (!blocksContainer._renderedBlockIds) {
                blocksContainer._renderedBlockIds = new Set();
            }

            // Render new blocks
            blocks.forEach(block => {
                if (blocksContainer._renderedBlockIds.has(block.id)) {
                    return; // Already rendered
                }

                const blockEl = document.createElement('div');
                blockEl.className = 'progressive-block progressive-block-' + block.type;
                blockEl.id = msgId + '-block-' + block.id;

                if (block.type === 'table' && block.rows) {
                    // Render table with real data
                    blockEl.innerHTML = this.renderProgressiveTable(block);
                } else if (block.type === 'metrics' && block.items) {
                    blockEl.innerHTML = this.renderProgressiveMetrics(block);
                } else if (block.type === 'text' && block.content) {
                    blockEl.innerHTML = '<div class="progressive-text">' + this.escapeHtml(block.content) + '</div>';
                }

                blocksContainer.appendChild(blockEl);
                blocksContainer._renderedBlockIds.add(block.id);

                console.log('[Advisor] Rendered progressive block:', block.type, block.id);
            });

            this.scrollToBottom();
        },

        /**
         * Render a progressive table block with real data
         */
        renderProgressiveTable: function(block) {
            const title = block.title || 'Results';
            const headers = block.headers || [];
            const rows = block.rows || [];
            const totalRows = block.totalRows || rows.length;

            let html = '<div class="progressive-table-container">';
            html += '<div class="progressive-table-header">';
            html += '<span class="progressive-table-title">' + this.escapeHtml(title) + '</span>';
            if (totalRows > rows.length) {
                html += '<span class="progressive-table-count">Showing ' + rows.length + ' of ' + totalRows + '</span>';
            } else {
                html += '<span class="progressive-table-count">' + totalRows + ' rows</span>';
            }
            html += '</div>';

            html += '<div class="progressive-table-scroll">';
            html += '<table class="progressive-table">';
            html += '<thead><tr>';
            headers.forEach(h => {
                html += '<th>' + this.escapeHtml(this.formatHeader(h)) + '</th>';
            });
            html += '</tr></thead>';

            html += '<tbody>';
            rows.forEach(row => {
                html += '<tr>';
                row.forEach(cell => {
                    html += '<td>' + this.escapeHtml(String(cell)) + '</td>';
                });
                html += '</tr>';
            });
            html += '</tbody></table></div></div>';

            return html;
        },

        /**
         * Render progressive metrics block
         */
        renderProgressiveMetrics: function(block) {
            const items = block.items || [];
            let html = '<div class="progressive-metrics">';
            items.forEach(item => {
                const trendClass = item.trend === 'up' ? 'trend-up' : (item.trend === 'down' ? 'trend-down' : '');
                html += '<div class="progressive-metric ' + trendClass + '">';
                html += '<span class="metric-label">' + this.escapeHtml(item.label) + '</span>';
                html += '<span class="metric-value">' + this.escapeHtml(String(item.value)) + '</span>';
                html += '</div>';
            });
            html += '</div>';
            return html;
        },

        /**
         * Format header for display (convert snake_case to Title Case)
         */
        formatHeader: function(header) {
            if (!header) return '';
            return header
                .replace(/_/g, ' ')
                .replace(/\b\w/g, l => l.toUpperCase());
        },

        /**
         * Format column header for display (enhanced version)
         */
        formatColumnHeader: function(col) {
            if (!col) return '';
            // Common abbreviations to expand
            const expansions = {
                'id': 'ID', 'ar': 'AR', 'ap': 'AP', 'gl': 'GL',
                'ytd': 'YTD', 'mtd': 'MTD', 'qty': 'Qty'
            };
            return col
                .replace(/_/g, ' ')
                .split(' ')
                .map(word => expansions[word.toLowerCase()] || word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                .join(' ');
        },

        /**
         * Check if a column contains monetary values
         */
        isMonetaryColumn: function(col) {
            if (!col) return false;
            const lower = col.toLowerCase();
            const monetaryPatterns = [
                'amount', 'total', 'balance', 'spend', 'revenue', 'cost',
                'price', 'debit', 'credit', 'payment', 'bucket', 'outstanding',
                'current_bucket', 'days_1_30', 'days_31_60', 'days_61_90', 'days_over_90'
            ];
            return monetaryPatterns.some(p => lower.includes(p));
        },

        /**
         * Remove progressive message (for cleanup on major errors)
         */
        removeProgressiveMessage: function() {
            const progressiveMsgs = document.querySelectorAll('.advisor-message.progressive-loading');
            progressiveMsgs.forEach(msg => msg.remove());
        },

        /**
         * Stop current polling and cancel the in-flight request
         * Prevents resume after page reload
         */
        stopPolling: function() {
            if (!isProcessing) return;

            console.log('[Advisor] Stopping polling...');

            // Generate new polling ID to cause current loop to exit
            currentPollingId = 'stopped-' + Date.now();

            // Clear active request to prevent resume after reload
            activeRequest = null;

            // Update the progressive message to show it was stopped
            const progressiveMsg = document.querySelector('.advisor-message.progressive-loading');
            if (progressiveMsg) {
                const msgId = progressiveMsg.id;
                progressiveMsg.classList.remove('progressive-loading');
                progressiveMsg.classList.add('was-stopped');

                const stepsContainer = document.getElementById(msgId + '-steps');
                if (stepsContainer) {
                    // Remove thinking indicator
                    const thinking = stepsContainer.querySelector('.progressive-thinking');
                    if (thinking) thinking.remove();

                    // Add stopped step to the chain
                    const stoppedStep = {
                        type: 'stopped',
                        title: 'Stopped',
                        content: 'Response was stopped by user',
                        status: 'stopped'
                    };

                    const existingChain = stepsContainer.querySelector('.thought-chain');
                    if (existingChain && existingChain._stepsData) {
                        const allSteps = [...existingChain._stepsData, stoppedStep];
                        const chainHtml = this.renderSteps(allSteps);
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = chainHtml;
                        const newChain = tempDiv.firstElementChild;
                        if (newChain) {
                            newChain._stepsData = allSteps.map((s, i) => ({...s, _chainId: newChain.getAttribute('data-chain-id')}));
                            existingChain.replaceWith(newChain);
                        }
                    } else {
                        const chainHtml = this.renderSteps([stoppedStep]);
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = chainHtml;
                        const newChain = tempDiv.firstElementChild;
                        if (newChain) {
                            newChain._stepsData = [stoppedStep].map((s, i) => ({...s, _chainId: newChain.getAttribute('data-chain-id')}));
                            stepsContainer.appendChild(newChain);
                        }
                    }
                }
            }

            // Reset processing state
            isProcessing = false;
            this.updateSendButton(false);

            // Save session to persist the stopped state (no activeRequest)
            this.saveSession();

            console.log('[Advisor] Polling stopped');
        },

        /**
         * Sleep helper for polling
         */
        sleep: function(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        },

        /**
         * Update send button state and stop button visibility
         */
        updateSendButton: function(disabled) {
            const btn = document.getElementById('advisor-send-full');
            const stopBtn = document.getElementById('advisorStopPolling');
            if (btn) {
                btn.disabled = disabled;
            }
            // Enable stop button when processing, disable when not
            if (stopBtn) {
                if (disabled) {
                    stopBtn.classList.remove('disabled');
                } else {
                    stopBtn.classList.add('disabled');
                }
            }
        },

        /**
         * Retry the last query or a specific query
         */
        retryQuery: function(query) {
            const input = document.getElementById('advisor-input-full');
            if (!input) return;
            
            // Use provided query or fall back to lastUserMessage
            const queryToRetry = query || this.lastUserMessage;
            if (!queryToRetry) {
                console.warn('[Advisor] No query to retry');
                return;
            }
            
            // Set the input value and trigger send
            input.value = queryToRetry;
            this.sendMessage();
        },
        
        /**
         * Show thinking indicator
         */
        showThinking: function() {
            const container = document.getElementById('advisor-messages-full');
            if (!container) return null;
            
            // Use a consistent ID so we can find it later
            const id = 'advisor-thinking';
            
            // Remove any existing thinking indicator first
            const existing = document.getElementById(id);
            if (existing) existing.remove();
            
            const div = document.createElement('div');
            div.id = id;
            div.className = 'advisor-message assistant';
            div.innerHTML = `
                <div class="message-bubble">
                    <div class="thinking-indicator">
                        <div class="thinking-dot"></div>
                        <div class="thinking-dot"></div>
                        <div class="thinking-dot"></div>
                    </div>
                </div>
            `;
            container.appendChild(div);
            this.scrollToBottom();
            return id;
        },
        
        /**
         * Hide thinking indicator
         */
        hideThinking: function(id) {
            // Always try to remove the standard thinking element
            const el = document.getElementById(id || 'advisor-thinking');
            if (el) el.remove();
        },
        
        /**
         * Add a message to the chat
         */
        addMessage: function(role, content, richContent, steps) {
            const msg = {
                role: role,
                content: content,
                richContent: richContent || null,
                steps: steps || null,
                timestamp: Date.now()
            };
            messages.push(msg);
            this.renderMessage(msg);
            this.saveSession();
            this.scrollToBottom();
        },
        
        /**
         * Add assistant message with metadata
         */
        addAssistantMessage: function(response) {
            const msg = {
                role: 'assistant',
                content: response.text || '',
                richContent: response.richContent || null,
                steps: response.steps || null,
                model: response.model,
                provider: response.provider,
                duration: response.duration,
                userQuery: this.lastUserMessage || '',  // Store the user query for retry
                timestamp: Date.now()
            };
            messages.push(msg);
            this.renderMessageProgressive(msg);
            this.saveSession();
            
            // Merge session context from this response
            // This persists entity resolutions, order, topics, and history across messages
            if (response.sessionContext) {
                // Merge resolvedEntities (additive)
                if (response.sessionContext.resolvedEntities) {
                    sessionContext.resolvedEntities = sessionContext.resolvedEntities || {};
                    Object.assign(sessionContext.resolvedEntities, response.sessionContext.resolvedEntities);
                }
                
                // CRITICAL: Replace entityOrder with server's version (it tracks recency correctly)
                if (response.sessionContext.entityOrder && Array.isArray(response.sessionContext.entityOrder)) {
                    sessionContext.entityOrder = response.sessionContext.entityOrder;
                }
                
                // Merge topics (additive, keep unique)
                if (response.sessionContext.topics && Array.isArray(response.sessionContext.topics)) {
                    sessionContext.topics = sessionContext.topics || [];
                    response.sessionContext.topics.forEach(function(topic) {
                        if (sessionContext.topics.indexOf(topic) === -1) {
                            sessionContext.topics.push(topic);
                        }
                    });
                    // Keep last 20 topics
                    if (sessionContext.topics.length > 20) {
                        sessionContext.topics = sessionContext.topics.slice(-20);
                    }
                }
                
                // Replace queryHistory with server's version
                if (response.sessionContext.queryHistory && Array.isArray(response.sessionContext.queryHistory)) {
                    sessionContext.queryHistory = response.sessionContext.queryHistory;
                }
            }
            
            // Render follow-up suggestions if provided
            const suggestions = response.followUpSuggestions || 
                               (response.sessionContext && response.sessionContext.followUpSuggestions);
            if (suggestions && suggestions.length > 0) {
                this.renderFollowUpSuggestions(suggestions);
            } else {
                this.clearFollowUpSuggestions();
            }
        },
        
        /**
         * Render follow-up suggestions below input
         */
        renderFollowUpSuggestions: function(suggestions) {
            const container = document.getElementById('followUpSuggestions');
            if (!container) return;
            
            // Take max 3 suggestions
            const chips = suggestions.slice(0, 3);
            
            // Add title attribute for tooltip showing full text on hover
            container.innerHTML = chips.map(suggestion => 
                `<button class="follow-up-chip" data-suggestion="${this.escapeHtml(suggestion)}" title="${this.escapeHtml(suggestion)}">${this.escapeHtml(suggestion)}</button>`
            ).join('');
            
            // Bind click handlers
            container.querySelectorAll('.follow-up-chip').forEach(chip => {
                chip.addEventListener('click', () => {
                    const text = chip.dataset.suggestion;
                    if (text) {
                        const input = document.getElementById('advisor-input-full');
                        if (input) {
                            input.value = text;
                            this.sendMessage();
                        }
                    }
                });
            });
        },
        
        /**
         * Clear follow-up suggestions
         */
        clearFollowUpSuggestions: function() {
            const container = document.getElementById('followUpSuggestions');
            if (container) {
                container.innerHTML = '';
            }
        },
        
        /**
         * Render assistant message content (blocks format only)
         * Shared by both progressive and static rendering
         */
        renderAssistantContent: function(msg, bubble) {
            // Render steps as Neural Flow thought-chain
            if (msg.steps && msg.steps.length > 0) {
                const stepsContainer = document.createElement('div');
                stepsContainer.className = 'message-steps';
                stepsContainer.innerHTML = this.renderSteps(msg.steps);

                // Store step data on the thought-chain for expansion
                const thoughtChain = stepsContainer.querySelector('.thought-chain');
                if (thoughtChain) {
                    const chainId = thoughtChain.getAttribute('data-chain-id');
                    thoughtChain._stepsData = msg.steps.map(s => ({...s, _chainId: chainId}));
                }

                bubble.appendChild(stepsContainer);
            }
            
            // Render rich content blocks in natural order
            if (msg.richContent && msg.richContent.length > 0) {
                msg.richContent.forEach(item => {
                    const div = document.createElement('div');
                    div.className = item.type === 'text' ? 'message-text' : 'message-rich';
                    div.innerHTML = this.renderRichContent(item);
                    bubble.appendChild(div);
                });
            }
            
            // Render any legacy text content (fallback)
            if (msg.content && msg.content.trim() && (!msg.richContent || msg.richContent.length === 0)) {
                const textDiv = document.createElement('div');
                textDiv.className = 'message-text';
                textDiv.innerHTML = this.formatText(msg.content);
                bubble.appendChild(textDiv);
            }
            
            // Add message footer with model badge and response actions (always show for assistant messages)
            const modelName = msg.model || 'Gantry';
            const msgId = 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
            const retryQuery = msg.userQuery ? this.escapeHtml(msg.userQuery).replace(/'/g, "\\'") : '';
            const footer = document.createElement('div');
            footer.className = 'message-footer';
            footer.id = msgId;
            footer.innerHTML = `
                <div class="model-badge">${this.escapeHtml(modelName)}</div>
                <div class="response-actions">
                    <button class="action-btn action-btn-subtle" onclick="AdvisorChat.retryQuery('${retryQuery}')" title="Retry">
                        <i class="fas fa-redo"></i>
                    </button>
                    <button class="action-btn" onclick="AdvisorChat.copyResponse('${msgId}')" title="Copy">
                        <i class="fas fa-copy"></i>
                    </button>
                    <button class="action-btn" onclick="AdvisorChat.printResponse('${msgId}')" title="Print">
                        <i class="fas fa-print"></i>
                    </button>
                </div>
            `;
            bubble.appendChild(footer);
        },
        
        /**
         * Progressively render message with steps
         */
        renderMessageProgressive: async function(msg) {
            const container = document.getElementById('advisor-messages-full');
            if (!container) return;
            
            const div = document.createElement('div');
            div.className = 'advisor-message assistant';
            
            const bubble = document.createElement('div');
            bubble.className = 'message-bubble';
            div.appendChild(bubble);
            container.appendChild(div);
            
            this.renderAssistantContent(msg, bubble);
            this.scrollToBottom();
        },
        
        /**
         * Delay helper
         */
        delay: function(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        },
        
        /**
         * Render a single message (used for session restore)
         */
        renderMessage: function(msg) {
            const container = document.getElementById('advisor-messages-full');
            if (!container) return;
            
            const div = document.createElement('div');
            div.className = `advisor-message ${msg.role}`;
            
            if (msg.role === 'user') {
                const initial = this.getUserInitial();
                div.innerHTML = `<div class="message-bubble"><div class="user-bubble-inner" data-initial="${initial}"><div class="message-text">${this.escapeHtml(msg.content)}</div></div></div>`;
            } else {
                const bubble = document.createElement('div');
                bubble.className = 'message-bubble';
                div.appendChild(bubble);
                this.renderAssistantContent(msg, bubble);
            }
            
            container.appendChild(div);
        },
        
        /**
         * Get user initial for avatar
         */
        getUserInitial: function() {
            // Try to get from NetSuite user context or default to 'U'
            if (typeof window !== 'undefined' && window.gantryUser && window.gantryUser.name) {
                return window.gantryUser.name.charAt(0).toUpperCase();
            }
            return 'U';
        },
        
        /**
         * Normalize step status to standard values
         */
        normalizeStepStatus: function(status) {
            if (!status) return 'complete';
            if (status === 'in_progress' || status === 'processing' || status === 'pending' || status === 'running') {
                return 'running';
            }
            if (status === 'error' || status === 'failed') {
                return 'error';
            }
            return status;
        },

        /**
         * Render steps as Neural Flow thought-chain
         * @param {Array} steps - Array of step objects
         * @param {boolean} showPending - Show pending indicator at end (while still loading)
         * @param {string} existingChainId - Optional existing chain ID to preserve (for re-renders)
         */
        renderSteps: function(steps, showPending, existingChainId) {
            if (!steps || steps.length === 0) return '';

            // Filter out retry steps - they're intermediate and shouldn't be displayed
            const filteredSteps = steps.filter(s => s.type !== 'retry');
            if (filteredSteps.length === 0) return '';

            // Reuse existing chainId if provided (preserves expansion panel ID across re-renders)
            const chainId = existingChainId || ('chain-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9));
            const self = this;
            const allComplete = filteredSteps.every(s => self.normalizeStepStatus(s.status) === 'complete') && !showPending;
            const hasRunning = filteredSteps.some(s => self.normalizeStepStatus(s.status) === 'running');

            let html = `<div class="thought-chain${allComplete ? ' chain-complete' : ''}" data-chain-id="${chainId}">`;
            html += '<div class="thought-nodes">';

            filteredSteps.forEach((step, idx) => {
                // Normalize status for connector logic
                const stepStatus = this.normalizeStepStatus(step.status);

                // Add connector before node (except for first)
                if (idx > 0) {
                    // Connector is "active" if current step is running, otherwise "completed"
                    const connectorClass = stepStatus === 'running' ? 'active' : 'completed';
                    html += `<div class="node-connector ${connectorClass} animate-in cascade-delay-${idx}" style="--flow-delay: ${idx * 0.3}s"></div>`;
                }

                // Mark as final if it's the last node and we're not still loading
                const isFinal = (idx === filteredSteps.length - 1) && !showPending;
                html += this.renderThoughtNode(step, idx, chainId, isFinal);
            });

            // Add pending indicator at end if still loading
            if (showPending && !hasRunning) {
                const lastIdx = filteredSteps.length;
                html += `<div class="node-connector active animate-in cascade-delay-${lastIdx}" style="--flow-delay: ${lastIdx * 0.3}s"></div>`;
                html += `
                    <div class="thinking-node-indicator inline">
                        <div class="thinking-node-core">
                            <i class="fas fa-brain"></i>
                        </div>
                        <div class="thinking-node-ring"></div>
                    </div>
                `;
            }

            // Add thinking trail if there's a running step
            if (hasRunning) {
                html += `<div class="thinking-trail"><span></span><span></span><span></span></div>`;
            }

            html += '</div>'; // close thought-nodes

            // Add expansion panel container (hidden by default)
            html += `<div class="expansion-panel" id="${chainId}-expansion"></div>`;

            html += '</div>'; // close thought-chain

            return html;
        },

        /**
         * Render a single thought node for Neural Flow
         * @param {Object} step - Step object
         * @param {number} idx - Index in chain
         * @param {string} chainId - Chain ID
         * @param {boolean} isFinal - Whether this is the final node (for special styling)
         */
        renderThoughtNode: function(step, idx, chainId, isFinal) {
            // Normalize status - handle various backend status values
            let statusClass = step.status || 'complete';
            // Map various "in progress" statuses to "running"
            if (statusClass === 'in_progress' || statusClass === 'processing' || statusClass === 'pending') {
                statusClass = 'running';
            }

            const icon = this.getStepIcon(step);
            const title = step.title || step.type || 'Processing';
            const shortTitle = title.length > 30 ? title.substring(0, 30) + '...' : title;

            // Format duration
            let duration = '';
            if (step.meta && step.meta.duration) {
                duration = (step.meta.duration / 1000).toFixed(1) + 's';
            } else if (step.duration) {
                duration = (step.duration / 1000).toFixed(1) + 's';
            }

            // Build tooltip status class
            const tooltipStatusClass = statusClass === 'complete' ? 'complete' :
                                       statusClass === 'running' ? 'running' :
                                       statusClass === 'error' ? 'error' : 'pending';

            const isRunning = statusClass === 'running';
            const finalClass = isFinal ? ' final' : '';

            let html = `
                <div class="thought-node ${statusClass}${finalClass} animate-in cascade-delay-${idx + 1}"
                     data-step-idx="${idx}"
                     data-chain-id="${chainId}"
                     onclick="AdvisorController.toggleExpansion('${chainId}', ${idx}); event.stopPropagation();">
                    <div class="node-core">${icon}</div>
                    <div class="node-ring"></div>
                    ${isRunning ? '<div class="orbital-dots"><span></span><span></span><span></span></div>' : ''}
                    <div class="node-particles"><span></span><span></span><span></span><span></span><span></span><span></span></div>
                    <div class="node-tooltip">
                        <div class="tooltip-title">${icon} ${this.escapeHtml(shortTitle)}</div>
                        <div class="tooltip-meta">
                            ${duration ? `<span class="tooltip-duration"><i class="fas fa-clock"></i> ${duration}</span>` : ''}
                            <span class="tooltip-status ${tooltipStatusClass}">${statusClass}</span>
                        </div>
                        ${isRunning ? '<div class="tooltip-progress"><div class="tooltip-progress-bar" style="width: 60%"></div></div>' : ''}
                    </div>
                </div>
            `;

            return html;
        },

        /**
         * Toggle expansion panel for a thought node
         */
        toggleExpansion: function(chainId, stepIdx) {
            const chain = document.querySelector(`[data-chain-id="${chainId}"]`);
            if (!chain) return;

            const panel = document.getElementById(chainId + '-expansion');
            if (!panel) return;

            const currentIdx = panel.getAttribute('data-expanded-idx');

            // If clicking same node, close it
            if (currentIdx === String(stepIdx) && panel.classList.contains('visible')) {
                this.closeExpansion(chainId);
                return;
            }

            // Close any OTHER open panels first (not the one we're about to open)
            document.querySelectorAll('.expansion-panel.visible').forEach(p => {
                if (p.id !== chainId + '-expansion') {
                    p.classList.add('closing');
                    setTimeout(() => {
                        p.classList.remove('visible', 'closing');
                        p.setAttribute('data-expanded-idx', '');
                    }, 200);
                    // Remove click handler if exists
                    if (p._closeHandler) {
                        document.removeEventListener('click', p._closeHandler);
                        delete p._closeHandler;
                    }
                }
            });
            document.querySelectorAll('.thought-node.expanded').forEach(n => n.classList.remove('expanded'));

            // Get step data from the chain's stored data
            const steps = chain._stepsData || [];
            const step = steps[stepIdx];

            if (!step) {
                console.warn('Step data not found for expansion');
                return;
            }

            // Build expansion content
            const content = this.buildExpansionContent(step);

            panel.innerHTML = content;
            panel.setAttribute('data-expanded-idx', stepIdx);
            panel.classList.add('visible');

            // Highlight the selected node
            chain.querySelectorAll('.thought-node').forEach((n, i) => {
                n.classList.toggle('expanded', i === stepIdx);
            });

            // Add click-outside listener
            const self = this;
            setTimeout(() => {
                const closeHandler = function(e) {
                    if (!panel.contains(e.target) && !e.target.closest('.thought-node')) {
                        self.closeExpansion(chainId);
                        document.removeEventListener('click', closeHandler);
                    }
                };
                document.addEventListener('click', closeHandler);
                panel._closeHandler = closeHandler;
            }, 10);
        },

        /**
         * Close expansion panel with animation
         */
        closeExpansion: function(chainId) {
            const panel = document.getElementById(chainId + '-expansion');
            if (panel && panel.classList.contains('visible')) {
                panel.classList.add('closing');
                setTimeout(() => {
                    panel.classList.remove('visible', 'closing');
                    panel.setAttribute('data-expanded-idx', '');
                }, 200);

                // Remove click handler if exists
                if (panel._closeHandler) {
                    document.removeEventListener('click', panel._closeHandler);
                    delete panel._closeHandler;
                }
            }

            const chain = document.querySelector(`[data-chain-id="${chainId}"]`);
            if (chain) {
                chain.querySelectorAll('.thought-node').forEach(n => n.classList.remove('expanded'));
            }
        },

        /**
         * Build expansion panel content for a step
         */
        buildExpansionContent: function(step) {
            const icon = this.getStepIcon(step);
            const title = step.title || step.type || 'Processing';
            const chainId = step._chainId || '';

            // Format duration
            let duration = '';
            if (step.meta && step.meta.duration) {
                duration = (step.meta.duration / 1000).toFixed(1) + 's';
            } else if (step.duration) {
                duration = (step.duration / 1000).toFixed(1) + 's';
            }

            // Get model info
            let model = '';
            if (step.meta && step.meta.model) {
                model = step.meta.model;
            }

            let html = `
                <div class="expansion-panel-header">
                    <div class="expansion-panel-title">${icon} ${this.escapeHtml(title)}</div>
                    <button class="expansion-panel-close" onclick="AdvisorController.closeExpansion('${chainId}')">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="expansion-panel-body">
            `;

            // Add meta info (duration, model, tool badge on one row)
            if (duration || model || step.tool) {
                html += '<div class="expansion-panel-meta">';
                // Add tool badge first if present
                if (step.tool) {
                    const toolIcons = {
                        'resolve_entity': 'fa-search',
                        'resolve_gl_account': 'fa-calculator',
                        'resolve_classification': 'fa-tags',
                        'explore_schema': 'fa-sitemap',
                        'get_ap_aging': 'fa-clock',
                        'get_ar_aging': 'fa-clock',
                        'get_vendor_spend': 'fa-store',
                        'get_customer_revenue': 'fa-users',
                        'get_gl_activity': 'fa-book',
                        'get_trial_balance': 'fa-balance-scale',
                        'get_income_statement': 'fa-file-invoice-dollar',
                        'get_balance_sheet': 'fa-balance-scale-right',
                        'get_recent_transactions': 'fa-list',
                        'get_transaction_detail': 'fa-file-alt',
                        'compare_periods': 'fa-chart-line',
                        'find_anomalies': 'fa-exclamation-triangle',
                        'get_cash_position': 'fa-money-bill-wave',
                        'get_expense_breakdown': 'fa-receipt',
                        'dashboard_cashflow': 'fa-chart-area',
                        'dashboard_health': 'fa-heartbeat',
                        'dashboard_burden': 'fa-weight-hanging',
                        'dashboard_time': 'fa-clock',
                        'dashboard_integrity': 'fa-shield-alt',
                        'dashboard_vendorperformance': 'fa-handshake',
                        'dashboard_customervalue': 'fa-gem',
                        'dashboard_spendvelocity': 'fa-tachometer-alt',
                        'run_custom_query': 'fa-database'
                    };
                    const toolIcon = toolIcons[step.tool] || 'fa-cog';
                    const toolLabel = step.tool.replace(/_/g, ' ');
                    html += `<span class="step-tool-badge"><i class="fas ${toolIcon}"></i> ${this.escapeHtml(toolLabel)}</span>`;
                }
                if (duration) {
                    html += `<span><i class="fas fa-clock"></i> ${duration}</span>`;
                }
                if (model) {
                    html += `<span class="meta-model"><i class="fas fa-brain"></i> ${this.escapeHtml(model)}</span>`;
                }
                html += '</div>';
            }

            // Add step-specific content
            html += this.buildStepDetailContent(step);

            html += '</div>'; // close body

            return html;
        },

        /**
         * Build detail content for a step (used in expansion panel)
         */
        buildStepDetailContent: function(step) {
            let detailContent = '';

            // Special handling for thinking steps - show AI plan if available
            if (step.type === 'thinking') {
                // SCA Phase-specific rendering with rich context data
                if (step.context && step.context.phase) {
                    const ctx = step.context;
                    detailContent += '<div class="sca-phase-details">';

                    // ═══ INTENT PHASE ═══
                    if (ctx.phase === 'intent') {
                        // Intent classification badge
                        if (ctx.intent) {
                            const intentIcons = {
                                'entity_lookup': 'fa-search',
                                'top_list': 'fa-list-ol',
                                'aging': 'fa-clock',
                                'reporting': 'fa-chart-bar',
                                'dashboard': 'fa-tachometer-alt',
                                'comparison': 'fa-balance-scale',
                                'transaction': 'fa-receipt',
                                'general': 'fa-comment'
                            };
                            const intentColors = {
                                'entity_lookup': '#6366f1',
                                'top_list': '#8b5cf6',
                                'aging': '#f59e0b',
                                'reporting': '#10b981',
                                'dashboard': '#3b82f6',
                                'comparison': '#ec4899',
                                'transaction': '#14b8a6',
                                'general': '#6b7280'
                            };
                            const icon = intentIcons[ctx.intent] || 'fa-question';
                            const color = intentColors[ctx.intent] || '#6b7280';
                            detailContent += `
                                <div class="sca-intent-card">
                                    <div class="intent-badge" style="background: ${color}20; border-left: 3px solid ${color};">
                                        <i class="fas ${icon}" style="color: ${color};"></i>
                                        <span class="intent-label">Intent Classified</span>
                                        <span class="intent-value" style="color: ${color};">${this.escapeHtml(ctx.intent.replace(/_/g, ' '))}</span>
                                    </div>
                                </div>`;
                        }

                        // Question analyzed
                        if (ctx.question) {
                            detailContent += `
                                <div class="sca-section">
                                    <div class="sca-label"><i class="fas fa-quote-left"></i> Query Analyzed</div>
                                    <div class="sca-query-text">"${this.escapeHtml(ctx.question)}"</div>
                                </div>`;
                        }

                        // Entities detected
                        if (ctx.entities && ctx.entities.length > 0) {
                            detailContent += `
                                <div class="sca-section">
                                    <div class="sca-label"><i class="fas fa-tags"></i> Entities Detected</div>
                                    <div class="sca-entity-chips">
                                        ${ctx.entities.map(e => `<span class="sca-chip entity-chip"><i class="fas fa-tag"></i> ${this.escapeHtml(e)}</span>`).join('')}
                                    </div>
                                </div>`;
                        }

                        // Time scope
                        if (ctx.timeScope && ctx.timeScope !== 'none') {
                            const scopeLabels = { 'ytd': 'Year to Date', 'mtd': 'Month to Date', 'last_30': 'Last 30 Days', 'custom': 'Custom Range' };
                            detailContent += `
                                <div class="sca-inline-item">
                                    <i class="fas fa-calendar-alt"></i>
                                    <span class="sca-scope-badge">${scopeLabels[ctx.timeScope] || ctx.timeScope}</span>
                                </div>`;
                        }

                        // Needs resolution indicator
                        if (ctx.needsResolution) {
                            detailContent += `
                                <div class="sca-inline-item sca-needs-resolution">
                                    <i class="fas fa-search-plus"></i>
                                    <span>Entity resolution required</span>
                                </div>`;
                        }
                    }

                    // ═══ SELECT PHASE ═══
                    else if (ctx.phase === 'select') {
                        // Selected tools with icons
                        if (ctx.selectedTools && ctx.selectedTools.length > 0) {
                            const toolIcons = {
                                'get_ar_aging': 'fa-clock', 'get_ap_aging': 'fa-clock',
                                'get_top_customers': 'fa-users', 'get_top_vendors': 'fa-truck',
                                'get_customer_revenue': 'fa-dollar-sign', 'get_vendor_spend': 'fa-shopping-cart',
                                'get_gl_activity': 'fa-book', 'get_trial_balance': 'fa-balance-scale',
                                'get_cash_position': 'fa-piggy-bank', 'get_recent_transactions': 'fa-list',
                                'resolve_entity': 'fa-search', 'run_custom_query': 'fa-code'
                            };
                            detailContent += `
                                <div class="sca-section">
                                    <div class="sca-label"><i class="fas fa-toolbox"></i> Tools Selected</div>
                                    <div class="sca-tools-grid">
                                        ${ctx.selectedTools.map(tool => {
                                            const icon = toolIcons[tool] || 'fa-cog';
                                            const displayName = tool.replace(/^get_/, '').replace(/_/g, ' ');
                                            return `<div class="sca-tool-card">
                                                <i class="fas ${icon}"></i>
                                                <span>${this.escapeHtml(displayName)}</span>
                                            </div>`;
                                        }).join('')}
                                    </div>
                                </div>`;
                        }

                        // AI reasoning
                        if (ctx.reasoning) {
                            detailContent += `
                                <div class="sca-section">
                                    <div class="sca-label"><i class="fas fa-lightbulb"></i> AI Reasoning</div>
                                    <div class="sca-reasoning-text">${this.escapeHtml(ctx.reasoning)}</div>
                                </div>`;
                        }

                        // Intent context
                        if (ctx.intent) {
                            detailContent += `
                                <div class="sca-inline-item">
                                    <i class="fas fa-crosshairs"></i>
                                    <span>For <strong>${this.escapeHtml(ctx.intent.replace(/_/g, ' '))}</strong> query</span>
                                </div>`;
                        }
                    }

                    // ═══ ANALYZE PHASE ═══
                    else if (ctx.phase === 'analyze') {
                        if (ctx.hasAnalysis) {
                            detailContent += `
                                <div class="sca-analysis-card">
                                    <div class="analysis-status success">
                                        <i class="fas fa-check-circle"></i>
                                        <span>Analysis Complete</span>
                                    </div>
                                    ${ctx.findingsCount > 0 ? `
                                        <div class="analysis-findings">
                                            <i class="fas fa-lightbulb"></i>
                                            <span>${ctx.findingsCount} key finding${ctx.findingsCount !== 1 ? 's' : ''} identified</span>
                                        </div>
                                    ` : ''}
                                </div>`;
                        } else if (ctx.loadingMoreData) {
                            detailContent += `
                                <div class="sca-analysis-card">
                                    <div class="analysis-status loading">
                                        <i class="fas fa-spinner fa-spin"></i>
                                        <span>Loading additional data...</span>
                                    </div>
                                    ${ctx.refId ? `<div class="analysis-ref">Reference: <code>${ctx.refId}</code></div>` : ''}
                                </div>`;
                        } else if (ctx.noData) {
                            detailContent += `
                                <div class="sca-analysis-card">
                                    <div class="analysis-status warning">
                                        <i class="fas fa-exclamation-triangle"></i>
                                        <span>No data available for analysis</span>
                                    </div>
                                </div>`;
                        } else {
                            detailContent += `
                                <div class="sca-analysis-card">
                                    <div class="analysis-status active">
                                        <i class="fas fa-microscope"></i>
                                        <span>Analyzing ${ctx.dataRefs || 0} data source${ctx.dataRefs !== 1 ? 's' : ''}...</span>
                                    </div>
                                </div>`;
                        }

                        // Iteration count (for debugging/transparency)
                        if (ctx.iteration && ctx.iteration > 1) {
                            detailContent += `
                                <div class="sca-inline-item">
                                    <i class="fas fa-redo"></i>
                                    <span>Analysis iteration ${ctx.iteration}</span>
                                </div>`;
                        }
                    }

                    // ═══ FORMAT PHASE ═══
                    else if (ctx.phase === 'format') {
                        if (ctx.blockCount > 0) {
                            const blockIcons = { 'text': 'fa-paragraph', 'table': 'fa-table', 'metrics': 'fa-chart-line', 'list': 'fa-list-ul' };
                            detailContent += `
                                <div class="sca-format-card">
                                    <div class="format-header">
                                        <i class="fas fa-magic"></i>
                                        <span>Generating ${ctx.blockCount} content block${ctx.blockCount !== 1 ? 's' : ''}</span>
                                    </div>
                                    ${ctx.blockTypes && ctx.blockTypes.length > 0 ? `
                                        <div class="format-blocks">
                                            ${ctx.blockTypes.map(type => {
                                                const icon = blockIcons[type] || 'fa-cube';
                                                return `<span class="format-block-chip"><i class="fas ${icon}"></i> ${type}</span>`;
                                            }).join('')}
                                        </div>
                                    ` : ''}
                                </div>`;
                        } else {
                            detailContent += `
                                <div class="sca-format-card">
                                    <div class="format-header active">
                                        <i class="fas fa-spinner fa-spin"></i>
                                        <span>Formatting response...</span>
                                    </div>
                                </div>`;
                        }
                    }

                    // Circuit breaker / fallback indicators
                    if (ctx.circuitBreaker) {
                        detailContent += `
                            <div class="sca-circuit-breaker">
                                <i class="fas fa-bolt"></i>
                                <span>Circuit breaker triggered - using optimized path</span>
                            </div>`;
                    }
                    if (ctx.fallback) {
                        detailContent += `
                            <div class="sca-fallback-notice">
                                <i class="fas fa-life-ring"></i>
                                <span>Using fallback response</span>
                                ${ctx.error ? `<div class="fallback-error">${this.escapeHtml(ctx.error.substring(0, 100))}</div>` : ''}
                            </div>`;
                    }

                    detailContent += '</div>';
                }
                // Check for new AI plan format first (from createPlanAndUpdateThinking)
                else if (step.plan && step.plan.goal_understanding) {
                    const plan = step.plan;
                    detailContent += '<div class="thinking-plan-details">';

                    // Goal understanding
                    if (plan.goal_understanding) {
                        detailContent += `<div class="plan-section">
                            <div class="plan-label"><i class="fas fa-bullseye"></i> Understanding:</div>
                            <div class="plan-value">${this.escapeHtml(plan.goal_understanding)}</div>
                        </div>`;
                    }

                    // Data needed
                    if (plan.data_needed && plan.data_needed.length > 0) {
                        detailContent += `<div class="plan-section">
                            <div class="plan-label"><i class="fas fa-database"></i> Data Needed:</div>
                            <ul class="plan-data-list">
                                ${plan.data_needed.map(d => `<li>${this.escapeHtml(d)}</li>`).join('')}
                            </ul>
                        </div>`;
                    }

                    // Plan steps
                    if (plan.plan_steps && plan.plan_steps.length > 0) {
                        detailContent += `<div class="plan-section">
                            <div class="plan-label"><i class="fas fa-tasks"></i> Plan:</div>
                            <ol class="plan-step-list">
                                ${plan.plan_steps.map(s => {
                                    const toolBadge = s.tool ? `<code class="tool-badge">${this.escapeHtml(s.tool)}</code>` : '';
                                    return `<li>${this.escapeHtml(s.action)} ${toolBadge}</li>`;
                                }).join('')}
                            </ol>
                        </div>`;
                    }

                    // Completion criteria
                    if (plan.completion_criteria) {
                        detailContent += `<div class="plan-section">
                            <div class="plan-label"><i class="fas fa-check-circle"></i> Done When:</div>
                            <div class="plan-value">${this.escapeHtml(plan.completion_criteria)}</div>
                        </div>`;
                    }

                    detailContent += '</div>';
                }
                // Debug info (when debug mode is on)
                else if (step.debug) {
                    const debug = step.debug;
                    detailContent += '<div class="thinking-debug-details">';

                    // User message
                    if (debug.userMessage) {
                        detailContent += `<div class="debug-section">
                            <div class="debug-label"><i class="fas fa-comment"></i> User Message:</div>
                            <div class="debug-value">${this.escapeHtml(debug.userMessage)}</div>
                        </div>`;
                    }

                    // History length
                    if (debug.historyLength !== undefined) {
                        detailContent += `<div class="debug-item">
                            <i class="fas fa-history"></i> History: ${debug.historyLength} messages
                        </div>`;
                    }

                    // Session entities
                    if (debug.sessionEntities && debug.sessionEntities.length > 0) {
                        detailContent += `<div class="debug-section">
                            <div class="debug-label"><i class="fas fa-database"></i> Known Entities:</div>
                            <div class="debug-chips">${debug.sessionEntities.map(e =>
                                `<span class="debug-chip">${this.escapeHtml(e)}</span>`
                            ).join('')}</div>
                        </div>`;
                    }

                    // System prompt preview
                    if (debug.systemPromptPreview) {
                        detailContent += `<div class="debug-section">
                            <div class="debug-label"><i class="fas fa-cog"></i> System Prompt Preview:</div>
                            <pre class="debug-code">${this.escapeHtml(debug.systemPromptPreview)}</pre>
                        </div>`;
                    }

                    // Available tools
                    if (debug.availableTools && debug.availableTools.length > 0) {
                        const toolsPreview = debug.availableTools.slice(0, 10).join(', ');
                        const more = debug.availableTools.length > 10 ? ` +${debug.availableTools.length - 10} more` : '';
                        detailContent += `<div class="debug-section">
                            <div class="debug-label"><i class="fas fa-tools"></i> Available Tools (${debug.availableTools.length}):</div>
                            <div class="debug-value">${this.escapeHtml(toolsPreview)}${more}</div>
                        </div>`;
                    }

                    detailContent += '</div>';
                } else {
                    // No plan or debug info - show basic message
                    detailContent += `<div class="thinking-basic">
                        <i class="fas fa-brain"></i> Analyzing your question and determining which tools to use...
                    </div>`;
                }
            }

            // Special handling for planning steps - show rich details
            if (step.type === 'planning' && step.plan) {
                const plan = step.plan;
                
                // Show complexity badge
                if (plan.complexity) {
                    const complexityClass = plan.complexity === 'simple' ? 'success' : 
                                           plan.complexity === 'multi_step' ? 'warning' : 'info';
                    detailContent += `<div class="plan-complexity"><span class="complexity-badge ${complexityClass}">${this.escapeHtml(plan.complexity)}</span></div>`;
                }
                
                // Show reasoning
                if (plan.reasoning) {
                    detailContent += `<div class="plan-reasoning"><strong>Reasoning:</strong> ${this.escapeHtml(plan.reasoning)}</div>`;
                }
                
                // Show template match if present
                if (plan.template_match) {
                    detailContent += `<div class="plan-template"><i class="fas fa-puzzle-piece"></i> Template: <code>${this.escapeHtml(plan.template_match)}</code></div>`;
                }
                
                // Show entities to resolve
                if (plan.entities_to_resolve && plan.entities_to_resolve.length > 0) {
                    const entityList = plan.entities_to_resolve.map(e => 
                        `<span class="entity-chip">${this.escapeHtml(e.term)} <small>(${e.entity_type})</small></span>`
                    ).join(' ');
                    detailContent += `<div class="plan-entities"><i class="fas fa-search"></i> Entities: ${entityList}</div>`;
                }
                
                // Show plan steps
                if (plan.plan && plan.plan.length > 0) {
                    detailContent += '<div class="plan-steps"><strong>Plan:</strong><ol class="plan-step-list">';
                    plan.plan.forEach(s => {
                        const actionIcon = s.action === 'query' ? 'fa-database' : 
                                          s.action === 'template' ? 'fa-puzzle-piece' :
                                          s.action === 'resolve_entity' ? 'fa-search' : 'fa-cog';
                        detailContent += `<li><i class="fas ${actionIcon}"></i> ${this.escapeHtml(s.purpose || s.action)}</li>`;
                    });
                    detailContent += '</ol></div>';
                }
                
                // Show if synthesis required
                if (plan.requires_synthesis === true) {
                    detailContent += `<div class="plan-synthesis"><i class="fas fa-brain"></i> Requires synthesis</div>`;
                }
            }
            
            // Special handling for template steps - show template details
            if (step.type === 'template') {
                // Show template ID
                if (step.templateId) {
                    detailContent += `<div class="template-id"><i class="fas fa-puzzle-piece"></i> Template: <code>${this.escapeHtml(step.templateId)}</code></div>`;
                }
                
                // Show category badge if present
                if (step.templateCategory) {
                    const categoryClass = {
                        'AR': 'warning',
                        'AP': 'danger', 
                        'CASH': 'success',
                        'REVENUE': 'info',
                        'EXPENSE': 'danger',
                        'TRANSACTIONS': 'secondary'
                    }[step.templateCategory] || 'info';
                    detailContent += `<div class="template-category"><span class="category-badge ${categoryClass}">${this.escapeHtml(step.templateCategory)}</span></div>`;
                }
                
                // Show description/content if present
                if (step.content) {
                    detailContent += `<div class="template-description"><i class="fas fa-info-circle"></i> ${this.escapeHtml(step.content)}</div>`;
                }
            }
            
            // Special handling for tool_call steps (from v2 Agent / SCA)
            // Note: duration and tool badge are shown in expansion-panel-meta (buildExpansionContent)
            if (step.type === 'tool_call') {
                // Get result data (SCA stores in step.result, legacy stores directly on step)
                const result = step.result || {};
                const rowCount = step.rowCount !== undefined ? step.rowCount : result.rowCount;
                const columns = step.columns || result.columns || [];
                const preview = step.preview || result.preview || [];
                const dataRef = step.dataRef || result.dataRef;

                detailContent += '<div class="sca-tool-call-details">';

                // Tool execution header with status
                const isSuccess = step.success !== false && result.success !== false && !step.error;
                detailContent += `
                    <div class="tool-execution-header ${isSuccess ? 'success' : 'error'}">
                        <div class="execution-status">
                            <i class="fas ${isSuccess ? 'fa-check-circle' : 'fa-times-circle'}"></i>
                            <span>${isSuccess ? 'Executed Successfully' : 'Execution Failed'}</span>
                        </div>
                        ${step.duration ? `<div class="execution-time"><i class="fas fa-clock"></i> ${step.duration}ms</div>` : ''}
                    </div>`;

                // Show parameters as chips
                if (step.params && Object.keys(step.params).length > 0) {
                    const hasParams = Object.entries(step.params).some(([k, v]) => v !== null && v !== undefined);
                    if (hasParams) {
                        detailContent += `
                            <div class="tool-params-section">
                                <div class="section-label"><i class="fas fa-sliders-h"></i> Parameters</div>
                                <div class="tool-params-grid">
                                    ${Object.entries(step.params)
                                        .filter(([k, v]) => v !== null && v !== undefined)
                                        .map(([k, v]) => `
                                            <div class="param-item">
                                                <span class="param-key">${this.escapeHtml(k)}</span>
                                                <span class="param-value">${this.escapeHtml(String(v))}</span>
                                            </div>
                                        `).join('')}
                                </div>
                            </div>`;
                    }
                }

                // Show resolved entity details (from resolve_entity, resolve_gl_account, etc.)
                const entity = step.entity || result.entity;
                const bestMatch = step.bestMatch || result.bestMatch;
                if (entity) {
                    detailContent += `
                        <div class="entity-result-card">
                            <div class="entity-header">
                                <i class="fas fa-check-circle"></i>
                                <span>Entity Resolved</span>
                            </div>
                            <div class="entity-details-grid">
                                <div class="entity-name">${this.escapeHtml(entity.name)}</div>
                                <div class="entity-meta">
                                    <span class="entity-type-badge">${this.escapeHtml(entity.type)}</span>
                                    <span class="entity-id-badge">ID: ${entity.id}</span>
                                </div>
                            </div>
                        </div>`;
                } else if (bestMatch) {
                    detailContent += `
                        <div class="entity-result-card">
                            <div class="entity-header">
                                <i class="fas fa-check-circle"></i>
                                <span>Match Found</span>
                            </div>
                            <div class="entity-details-grid">
                                <div class="entity-name">${this.escapeHtml(bestMatch.name || bestMatch.account_name)}</div>
                                <div class="entity-meta">
                                    ${bestMatch.account_type ? `<span class="entity-type-badge">${this.escapeHtml(bestMatch.account_type)}</span>` : ''}
                                    ${bestMatch.dimension_type ? `<span class="entity-type-badge">${this.escapeHtml(bestMatch.dimension_type)}</span>` : ''}
                                    <span class="entity-id-badge">ID: ${bestMatch.id}</span>
                                </div>
                            </div>
                        </div>`;
                } else if (step.found === false || result.found === false) {
                    detailContent += `
                        <div class="entity-result-card not-found">
                            <div class="entity-header">
                                <i class="fas fa-search"></i>
                                <span>No Match Found</span>
                            </div>
                            <div class="entity-suggestion">Try different search terms or check spelling</div>
                        </div>`;
                }

                // Show result summary stats
                if (rowCount !== undefined && rowCount > 0) {
                    detailContent += `
                        <div class="result-stats-card">
                            <div class="stat-item primary">
                                <i class="fas fa-table"></i>
                                <span class="stat-value">${rowCount.toLocaleString()}</span>
                                <span class="stat-label">rows returned</span>
                            </div>
                            ${columns.length > 0 ? `
                                <div class="stat-item">
                                    <i class="fas fa-columns"></i>
                                    <span class="stat-value">${columns.length}</span>
                                    <span class="stat-label">columns</span>
                                </div>
                            ` : ''}
                            ${dataRef ? `
                                <div class="stat-item">
                                    <i class="fas fa-database"></i>
                                    <span class="stat-label">Ref: <code>${dataRef}</code></span>
                                </div>
                            ` : ''}
                        </div>`;

                    // Show columns as chips
                    if (columns.length > 0) {
                        detailContent += `
                            <div class="columns-section">
                                <div class="section-label"><i class="fas fa-columns"></i> Columns</div>
                                <div class="column-chips">
                                    ${columns.slice(0, 10).map(col => `<span class="column-chip">${this.escapeHtml(col)}</span>`).join('')}
                                    ${columns.length > 10 ? `<span class="column-chip more">+${columns.length - 10} more</span>` : ''}
                                </div>
                            </div>`;
                    }
                }

                // Show data preview (first few rows)
                if (preview && preview.length > 0) {
                    const previewRows = preview.slice(0, 5);
                    const previewCols = columns.length > 0 ? columns : Object.keys(previewRows[0] || {});

                    if (previewCols.length > 0) {
                        detailContent += `
                            <div class="data-preview-section">
                                <div class="preview-header">
                                    <i class="fas fa-eye"></i>
                                    <span>Data Preview</span>
                                    <span class="preview-count">${previewRows.length} of ${rowCount || previewRows.length}</span>
                                </div>
                                <div class="preview-table-container">
                                    <table class="preview-table-enhanced">
                                        <thead>
                                            <tr>
                                                ${previewCols.slice(0, 6).map(col => `<th>${this.escapeHtml(this.formatColumnHeader(col))}</th>`).join('')}
                                                ${previewCols.length > 6 ? '<th class="more-col">...</th>' : ''}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${previewRows.map(row => `
                                                <tr>
                                                    ${previewCols.slice(0, 6).map(col => {
                                                        let val = row[col];
                                                        const isMonetary = this.isMonetaryColumn(col);
                                                        if (typeof val === 'number') {
                                                            val = isMonetary ? this.formatCurrency(val) : val.toLocaleString();
                                                        }
                                                        return `<td class="${isMonetary ? 'monetary' : ''}">${this.escapeHtml(String(val ?? ''))}</td>`;
                                                    }).join('')}
                                                    ${previewCols.length > 6 ? '<td class="more-col">...</td>' : ''}
                                                </tr>
                                            `).join('')}
                                        </tbody>
                                    </table>
                                </div>
                                ${rowCount && rowCount > previewRows.length ? `
                                    <div class="preview-footer">
                                        <i class="fas fa-ellipsis-h"></i>
                                        <span>${(rowCount - previewRows.length).toLocaleString()} more rows</span>
                                    </div>
                                ` : ''}
                            </div>`;
                    }
                }

                // Show error if present
                if (step.error || result.error) {
                    detailContent += `
                        <div class="tool-error-section">
                            <div class="error-header">
                                <i class="fas fa-exclamation-triangle"></i>
                                <span>Error</span>
                            </div>
                            <div class="error-message">${this.escapeHtml(step.error || result.error)}</div>
                        </div>`;
                }

                // Show summary (fallback if no rich data)
                if (step.summary && !entity && !bestMatch && !preview.length && !step.error) {
                    detailContent += `
                        <div class="tool-summary-section">
                            <i class="fas fa-info-circle"></i>
                            <span>${this.escapeHtml(step.summary)}</span>
                        </div>`;
                }

                detailContent += '</div>'; // close sca-tool-call-details
            }

            // Special handling for agent_step and tool types - show rich execution details
            if (step.type === 'agent_step' || step.type === 'tool') {
                // Show tool badge
                if (step.toolName) {
                    const toolIcons = {
                        'execute_query': 'fa-database',
                        'execute_template': 'fa-puzzle-piece',
                        'resolve_entity': 'fa-search',
                        'get_dashboard_data': 'fa-chart-bar',
                        'calculate': 'fa-calculator'
                    };
                    const toolIcon = toolIcons[step.toolName] || 'fa-cog';
                    const toolLabel = step.toolName.replace(/_/g, ' ');
                    detailContent += `<div class="step-tool-badge"><i class="fas ${toolIcon}"></i> ${this.escapeHtml(toolLabel)}</div>`;
                }
                
                // Show template parameters if present
                if (step.toolArgs && step.toolArgs.template_id) {
                    detailContent += `<div class="step-template-id"><i class="fas fa-puzzle-piece"></i> Template: <code>${this.escapeHtml(step.toolArgs.template_id)}</code></div>`;
                    
                    // Show parameters
                    if (step.toolArgs.parameters && Object.keys(step.toolArgs.parameters).length > 0) {
                        const paramChips = Object.entries(step.toolArgs.parameters)
                            .filter(([k, v]) => v !== null && v !== undefined)
                            .map(([k, v]) => `<span class="param-chip"><strong>${this.escapeHtml(k)}:</strong> ${this.escapeHtml(String(v))}</span>`)
                            .join('');
                        if (paramChips) {
                            detailContent += `<div class="step-params"><i class="fas fa-sliders-h"></i> ${paramChips}</div>`;
                        }
                    }
                }
                
                // Show substitutions (what was actually replaced in the query)
                if (step.substitutions && Object.keys(step.substitutions).length > 0) {
                    const subList = Object.entries(step.substitutions)
                        .map(([k, v]) => `<span class="sub-item"><code>${this.escapeHtml(k)}</code> → <em>${this.escapeHtml(String(v))}</em></span>`)
                        .join('');
                    detailContent += `<div class="step-substitutions"><i class="fas fa-exchange-alt"></i> Substitutions: ${subList}</div>`;
                }
                
                // Show columns returned
                if (step.columns && step.columns.length > 0) {
                    const columnChips = step.columns.map(c => `<span class="column-chip">${this.escapeHtml(c)}</span>`).join('');
                    detailContent += `<div class="step-columns"><i class="fas fa-columns"></i> ${columnChips}</div>`;
                }
                
                // Show sample data preview (compact table)
                if (step.sampleData && step.sampleData.length > 0 && step.columns) {
                    const previewRows = step.sampleData.slice(0, 3); // Max 3 rows
                    detailContent += '<div class="step-sample-data">';
                    detailContent += '<div class="sample-data-header"><i class="fas fa-eye"></i> Preview</div>';
                    detailContent += '<table class="sample-data-table"><thead><tr>';
                    step.columns.forEach(col => {
                        detailContent += `<th>${this.escapeHtml(col)}</th>`;
                    });
                    detailContent += '</tr></thead><tbody>';
                    previewRows.forEach(row => {
                        detailContent += '<tr>';
                        step.columns.forEach(col => {
                            let val = row[col];
                            // Format numbers
                            if (typeof val === 'number') {
                                if (col.toLowerCase().includes('amount') || col.toLowerCase().includes('total') || col.toLowerCase().includes('spend')) {
                                    val = this.formatCurrency(val);
                                } else {
                                    val = val.toLocaleString();
                                }
                            }
                            detailContent += `<td>${this.escapeHtml(String(val ?? ''))}</td>`;
                        });
                        detailContent += '</tr>';
                    });
                    detailContent += '</tbody></table>';
                    if (step.sampleData.length > 3) {
                        detailContent += `<div class="sample-data-more">+${step.sampleData.length - 3} more rows</div>`;
                    }
                    detailContent += '</div>';
                }
                
                // Show retry guidance if present
                if (step.retryGuidance) {
                    detailContent += `<div class="step-retry-guidance"><i class="fas fa-lightbulb"></i> ${this.escapeHtml(step.retryGuidance)}</div>`;
                }
                
                // Fallback for agent_step without detailed info
                if (!step.toolName && !step.sql && !step.sampleData) {
                    if (step.title && step.title.includes('Processing') || step.title && step.title.includes('Waiting')) {
                        detailContent += '<div class="step-info-fallback">';
                        detailContent += '<div class="fallback-item"><i class="fas fa-sync-alt"></i> Agent is processing results</div>';
                        if (step.content && step.content !== 'Processing...') {
                            detailContent += `<div class="fallback-item"><i class="fas fa-info-circle"></i> ${this.escapeHtml(step.content)}</div>`;
                        }
                        detailContent += '</div>';
                    } else if (step.content) {
                        detailContent += `<div class="step-content-detail"><i class="fas fa-info-circle"></i> ${this.escapeHtml(step.content)}</div>`;
                    }
                }
            }
            
            // Render deep_thinking step details
            if (step.type === 'deep_thinking' && step.deepThink) {
                const dt = step.deepThink;
                detailContent += '<div class="deep-think-details">';
                
                // Thinking type badge
                detailContent += `<div class="deep-think-type"><span class="thinking-type-badge">${this.escapeHtml(dt.type || 'analysis')}</span></div>`;
                
                // Reasoning steps
                if (dt.steps && dt.steps.length > 0) {
                    detailContent += '<div class="deep-think-reasoning"><div class="reasoning-label">Reasoning:</div><ol class="reasoning-steps">';
                    dt.steps.forEach(step => {
                        detailContent += `<li>${this.escapeHtml(step)}</li>`;
                    });
                    detailContent += '</ol></div>';
                }
                
                // Hypotheses
                if (dt.hypotheses && dt.hypotheses.length > 0) {
                    detailContent += '<div class="deep-think-hypotheses"><div class="section-label">Hypotheses:</div>';
                    dt.hypotheses.forEach(h => {
                        const actionIcon = h.action === 'support' ? '✅' : h.action === 'refute' ? '❌' : h.action === 'partial' ? '⚠️' : '💡';
                        detailContent += `<div class="hypothesis-item">${actionIcon} ${this.escapeHtml(h.text)}</div>`;
                    });
                    detailContent += '</div>';
                }
                
                // Findings
                if (dt.findings && dt.findings.length > 0) {
                    detailContent += '<div class="deep-think-findings"><div class="section-label">Findings:</div>';
                    dt.findings.forEach(f => {
                        const importanceClass = f.importance === 'high' ? 'high' : f.importance === 'low' ? 'low' : 'medium';
                        detailContent += `<div class="finding-item finding-${importanceClass}"><i class="fas fa-check-circle"></i> ${this.escapeHtml(f.insight)}</div>`;
                    });
                    detailContent += '</div>';
                }
                
                // Confidence
                if (dt.confidence && dt.confidence.overall !== undefined) {
                    const confidencePercent = Math.round(dt.confidence.overall * 100);
                    const confidenceClass = confidencePercent >= 70 ? 'high' : confidencePercent >= 40 ? 'medium' : 'low';
                    detailContent += `<div class="deep-think-confidence confidence-${confidenceClass}">
                        <i class="fas fa-chart-line"></i> Confidence: ${confidencePercent}%
                        ${dt.confidence.reasoning ? `<span class="confidence-reason">(${this.escapeHtml(dt.confidence.reasoning)})</span>` : ''}
                    </div>`;
                }
                
                detailContent += '</div>';
            }
            
            // Render reflection step details (from adaptive agent)
            if (step.type === 'reflection' && step.reflection) {
                const ref = step.reflection;
                detailContent += '<div class="reflection-details">';

                // Assessment badge with colors
                const assessmentColors = {
                    'on_track': 'success',
                    'needs_pivot': 'warning',
                    'needs_modification': 'warning',
                    'needs_expansion': 'info',
                    'partial_success': 'info',
                    'can_simplify': 'success',
                    'blocked': 'danger'
                };
                const assessmentColor = assessmentColors[ref.assessment] || 'info';
                const assessmentLabels = {
                    'on_track': '✓ On Track',
                    'needs_pivot': '↺ Strategy Change Needed',
                    'partial_success': '◐ Partial Success',
                    'blocked': '✗ Blocked'
                };
                const assessmentLabel = assessmentLabels[ref.assessment] || ref.assessment;

                detailContent += `<div class="reflection-assessment">
                    <span class="assessment-badge badge-${assessmentColor}">${this.escapeHtml(assessmentLabel)}</span>
                    <span class="confidence-badge">${Math.round((ref.confidence || 0.5) * 100)}% confident</span>
                </div>`;

                // Findings with importance indicators
                if (ref.findings && ref.findings.length > 0) {
                    detailContent += '<div class="reflection-findings"><div class="section-label"><i class="fas fa-lightbulb"></i> Insights:</div>';
                    ref.findings.forEach(f => {
                        const importanceIcon = f.importance === 'high' ? '🔴' : f.importance === 'medium' ? '🟡' : '🟢';
                        const importanceClass = f.importance === 'high' ? 'high' : f.importance === 'medium' ? 'medium' : 'low';
                        detailContent += `<div class="finding-item finding-${importanceClass}">${importanceIcon} ${this.escapeHtml(f.insight)}</div>`;
                    });
                    detailContent += '</div>';
                }

                // Failures with suggestions
                if (ref.failures && ref.failures.length > 0) {
                    detailContent += '<div class="reflection-failures"><div class="section-label"><i class="fas fa-exclamation-triangle"></i> Issues Found:</div>';
                    ref.failures.forEach(f => {
                        detailContent += `<div class="failure-item">
                            <span class="failure-tool"><i class="fas fa-tools"></i> ${this.escapeHtml(f.tool)}</span>
                            <span class="failure-reason">${this.escapeHtml(f.reason)}</span>
                            ${f.suggestion ? `<span class="failure-suggestion"><i class="fas fa-arrow-right"></i> ${this.escapeHtml(f.suggestion)}</span>` : ''}
                        </div>`;
                    });
                    detailContent += '</div>';
                }

                // Next strategy recommendation
                if (ref.nextStrategy) {
                    detailContent += `<div class="reflection-next-strategy">
                        <div class="section-label"><i class="fas fa-route"></i> Recommended Approach:</div>
                        <div class="strategy-text">${this.escapeHtml(ref.nextStrategy)}</div>
                    </div>`;
                }

                // Pivot reason if applicable
                if (ref.shouldPivot && ref.pivotReason) {
                    detailContent += `<div class="reflection-pivot-reason">
                        <i class="fas fa-random"></i> <strong>Pivoting because:</strong> ${this.escapeHtml(ref.pivotReason)}
                    </div>`;
                }

                detailContent += '</div>';
            }

            // Render strategy_pivot step details
            if (step.type === 'strategy_pivot' && step.strategy) {
                const strat = step.strategy;
                detailContent += '<div class="strategy-pivot-details">';

                // New strategy description
                if (strat.newStrategy) {
                    detailContent += `<div class="strategy-new">
                        <div class="section-label"><i class="fas fa-lightbulb"></i> New Strategy:</div>
                        <div class="strategy-description">${this.escapeHtml(strat.newStrategy)}</div>
                    </div>`;
                }

                // Reasoning
                if (strat.reasoning) {
                    detailContent += `<div class="strategy-reasoning">
                        <div class="section-label"><i class="fas fa-brain"></i> Why This Approach:</div>
                        <div class="reasoning-text">${this.escapeHtml(strat.reasoning)}</div>
                    </div>`;
                }

                // First tool to try
                if (strat.firstTool) {
                    detailContent += `<div class="strategy-first-tool">
                        <i class="fas fa-play-circle"></i> <strong>Starting with:</strong>
                        <code>${this.escapeHtml(strat.firstTool)}</code>
                        ${strat.firstToolArgs ? `<span class="tool-args">(${this.escapeHtml(JSON.stringify(strat.firstToolArgs))})</span>` : ''}
                    </div>`;
                }

                // Backup tools
                if (strat.backupTools && strat.backupTools.length > 0) {
                    detailContent += `<div class="strategy-backups">
                        <i class="fas fa-list"></i> <strong>Backup options:</strong>
                        ${strat.backupTools.map(t => `<code>${this.escapeHtml(t)}</code>`).join(', ')}
                    </div>`;
                }

                detailContent += '</div>';
            }
            
            // Render plan_adaptation step details
            if (step.type === 'plan_adaptation' && step.modifications) {
                detailContent += '<div class="plan-adaptation-details">';
                detailContent += '<div class="section-label">Plan Modifications:</div><ul class="modifications-list">';
                step.modifications.forEach(mod => {
                    const actionIcon = mod.action === 'add_query' ? '➕' : mod.action === 'skip_step' ? '⏭️' : mod.action === 'modify_step' ? '✏️' : '🔄';
                    detailContent += `<li><span class="mod-action">${actionIcon} ${this.escapeHtml(mod.action)}</span>: ${this.escapeHtml(mod.reason)}</li>`;
                });
                detailContent += '</ul></div>';
            }
            
            // Render dashboard step details
            if (step.type === 'dashboard') {
                detailContent += '<div class="dashboard-step-details">';
                
                // Show dashboard ID badge
                if (step.dashboardId) {
                    const dashboardNames = {
                        'cashflow': 'Liquidity',
                        'health': 'P&L',
                        'burden': 'True Cost',
                        'time': 'Billable IQ',
                        'integrity': 'Sentinel',
                        'vendorperformance': 'Procurement',
                        'customervalue': 'Revenue Intelligence',
                        'spendvelocity': 'Spend Velocity'
                    };
                    const displayName = dashboardNames[step.dashboardId] || step.dashboardId;
                    detailContent += `<div class="dashboard-badge"><i class="fas fa-chart-pie"></i> ${this.escapeHtml(displayName)}</div>`;
                }
                
                // Show cache status
                if (step.cached !== undefined) {
                    const cacheIcon = step.cached ? 'fa-bolt' : 'fa-cloud-download-alt';
                    const cacheText = step.cached ? 'Cached data' : 'Fresh data fetched';
                    detailContent += `<div class="cache-status"><i class="fas ${cacheIcon}"></i> ${cacheText}</div>`;
                }
                
                // Show data size
                if (step.dataSize) {
                    const sizeKB = (step.dataSize / 1024).toFixed(1);
                    detailContent += `<div class="data-size"><i class="fas fa-database"></i> ${sizeKB} KB loaded</div>`;
                }
                
                // Show metrics items if present
                if (step.metrics && step.metrics.length > 0) {
                    detailContent += '<div class="dashboard-metrics">';
                    step.metrics.forEach(item => {
                        detailContent += `<span class="metric-chip">${this.escapeHtml(item)}</span>`;
                    });
                    detailContent += '</div>';
                }
                
                detailContent += '</div>';
            }
            
            // Render analyzing step details  
            if (step.type === 'analyzing') {
                detailContent += '<div class="analyzing-step-details">';
                
                // Show what's being analyzed
                if (step.dashboardId) {
                    detailContent += `<div class="analyzing-source"><i class="fas fa-chart-pie"></i> Analyzing ${this.escapeHtml(step.dashboardId)} dashboard</div>`;
                }
                
                // Show data point count
                if (step.dataPointCount !== undefined) {
                    detailContent += `<div class="data-point-count"><i class="fas fa-list-ol"></i> ${step.dataPointCount} data points</div>`;
                }
                
                // Show section count
                if (step.sectionCount !== undefined) {
                    detailContent += `<div class="section-count"><i class="fas fa-layer-group"></i> ${step.sectionCount} data sections</div>`;
                }
                
                // If no specific info available, extract from title or show generic message
                if (!step.dashboardId && step.dataPointCount === undefined && step.sectionCount === undefined) {
                    // Try to extract row count from title like "Analyzing 1 rows"
                    const rowMatch = step.title && step.title.match(/(\d+)\s*rows?/i);
                    if (rowMatch) {
                        const rowCount = parseInt(rowMatch[1], 10);
                        detailContent += `<div class="analyzing-info"><i class="fas fa-table"></i> Processing ${rowCount} ${rowCount === 1 ? 'row' : 'rows'} of data</div>`;
                        if (rowCount === 1) {
                            detailContent += `<div class="analyzing-info"><i class="fas fa-check-circle"></i> Single result - formatting for display</div>`;
                        } else if (rowCount <= 10) {
                            detailContent += `<div class="analyzing-info"><i class="fas fa-list"></i> Small dataset - showing all results</div>`;
                        } else {
                            detailContent += `<div class="analyzing-info"><i class="fas fa-filter"></i> Analyzing patterns and preparing summary</div>`;
                        }
                    } else {
                        detailContent += `<div class="analyzing-info"><i class="fas fa-cog"></i> Processing query results</div>`;
                    }
                }
                
                detailContent += '</div>';
            }
            
            // Render text_response_warning step details (when LLM returns text instead of tool calls)
            if (step.type === 'text_response_warning') {
                detailContent += '<div class="text-response-warning-details">';
                
                // Show progress indicator
                if (step.completedQueries !== undefined && step.totalQueries !== undefined) {
                    const progress = step.totalQueries > 0 ? Math.round((step.completedQueries / step.totalQueries) * 100) : 0;
                    detailContent += `<div class="query-progress">
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${progress}%"></div>
                        </div>
                        <span class="progress-text">${step.completedQueries}/${step.totalQueries} queries completed</span>
                    </div>`;
                }
                
                // Show failure count
                if (step.consecutiveFailures) {
                    const severity = step.consecutiveFailures >= 3 ? 'high' : step.consecutiveFailures >= 2 ? 'medium' : 'low';
                    detailContent += `<div class="failure-count severity-${severity}">
                        <i class="fas fa-exclamation-triangle"></i> 
                        ${step.consecutiveFailures} consecutive text response${step.consecutiveFailures > 1 ? 's' : ''} (model not using tools)
                    </div>`;
                }
                
                // Show what the LLM returned
                if (step.llmResponse) {
                    detailContent += `<div class="llm-response-preview">
                        <div class="preview-label"><i class="fas fa-comment"></i> LLM response (instead of tool call):</div>
                        <pre class="llm-text-preview">${this.escapeHtml(step.llmResponse)}</pre>
                    </div>`;
                }
                
                detailContent += '</div>';
            }
            
            // Add content/message
            if (step.content) {
                detailContent += `<div class="tool-call-content">${this.escapeHtml(step.content)}</div>`;
            }
            
            // Add SQL with syntax highlighting and copy button
            if (step.sql) {
                const sqlId = 'sql-' + idx + '-' + Math.random().toString(36).substr(2, 5);
                const highlighted = this.highlightSQL(step.sql);
                detailContent += `
                    <div class="tool-call-sql">
                        <div class="sql-header">
                            <span>SuiteQL</span>
                            <button class="sql-copy-btn" onclick="event.stopPropagation(); AdvisorChat.copySQL('${sqlId}')" title="Copy SQL">
                                <i class="fas fa-copy"></i>
                            </button>
                        </div>
                        <pre class="sql-code" id="${sqlId}">${highlighted}</pre>
                    </div>
                `;
            }
            
            // Add row count if present (but not for tool_call steps which show it above via step-result-count)
            if (step.rowCount !== undefined && step.type !== 'tool_call') {
                detailContent += `<div class="tool-call-meta"><i class="fas fa-table"></i> ${step.rowCount} row${step.rowCount !== 1 ? 's' : ''} returned</div>`;
            }
            
            // Add error details
            if (step.error) {
                detailContent += `<div class="tool-call-error"><i class="fas fa-exclamation-circle"></i> ${this.escapeHtml(step.error)}</div>`;
            }

            // Add LLM calls if present
            if (step.type === 'llm_calls' && step.calls) {
                detailContent += '<div class="llm-calls-list">';
                step.calls.forEach(call => {
                    const duration = call.duration ? (call.duration / 1000).toFixed(1) + 's' : '';
                    const callStatus = call.error ? 'error' : '';
                    const typeIcon = call.type === 'tool_call' ? 'fa-wrench' :
                                    call.type === 'text' ? 'fa-comment' : 'fa-question';
                    const tierBadge = call.tier ? `<span class="llm-tier-badge tier-${call.tier}">T${call.tier}</span>` : '';
                    detailContent += `
                        <div class="llm-call-item ${callStatus}">
                            <i class="fas ${typeIcon} llm-type-icon"></i>
                            <span class="llm-call-purpose">${this.escapeHtml(call.purpose || 'AI call')}</span>
                            ${tierBadge}
                            <span class="llm-call-model">${this.escapeHtml(call.model || '')}</span>
                            <span class="llm-call-duration">${duration}</span>
                            ${call.error ? `<span class="llm-call-error-badge">Error</span>` : ''}
                        </div>
                    `;
                });
                detailContent += '</div>';
            }

            return detailContent || '<div class="step-content">No additional details</div>';
        },

        /**
         * LEGACY: Render a single step as compact expandable pill (kept for backwards compat)
         */
        renderStep: function(step, idx) {
            // This now uses the thought node format internally but returns a
            // backwards-compatible wrapper for any code that calls renderStep directly
            const chainId = 'legacy-' + Date.now();
            return this.renderThoughtNode(step, idx, chainId, false);
        },
        
        /**
         * Simple SQL syntax highlighting
         */
        highlightSQL: function(sql) {
            const escaped = this.escapeHtml(sql);
            // Highlight keywords
            const keywords = /\b(SELECT|FROM|WHERE|AND|OR|ORDER BY|GROUP BY|HAVING|JOIN|INNER|LEFT|RIGHT|OUTER|ON|AS|DISTINCT|COUNT|SUM|AVG|MIN|MAX|CASE|WHEN|THEN|ELSE|END|LIKE|IN|NOT|NULL|IS|BETWEEN|FETCH|FIRST|ROWS|ONLY|TO_DATE|TRUNC|CURRENT_DATE|BUILTIN\.DF|LIMIT|OFFSET|DESC|ASC|UNION|ALL)\b/gi;
            return escaped.replace(keywords, '<span class="keyword">$1</span>');
        },
        
        /**
         * Copy SQL to clipboard
         */
        copySQL: function(elementId) {
            const el = document.getElementById(elementId);
            if (!el) return;
            
            const text = el.textContent;
            navigator.clipboard.writeText(text).then(() => {
                // Show feedback
                const btn = el.parentElement.querySelector('.step-sql-copy');
                if (btn) {
                    const originalText = btn.innerHTML;
                    btn.innerHTML = '<i class="fas fa-check"></i> Copied';
                    btn.classList.add('copy-success');
                    setTimeout(() => {
                        btn.innerHTML = originalText;
                        btn.classList.remove('copy-success');
                    }, 2000);
                }
            });
        },

        /**
         * Get icon for step type
         */
        getStepIcon: function(step) {
            const icons = {
                'thinking': '<i class="fas fa-brain"></i>',
                'deep_thinking': '<i class="fas fa-brain"></i>',
                'reflection': '<i class="fas fa-lightbulb"></i>',
                'strategy_pivot': '<i class="fas fa-random"></i>',
                'plan_adaptation': '<i class="fas fa-project-diagram"></i>',
                'classification': '<i class="fas fa-sitemap"></i>',
                'template': '<i class="fas fa-file-code"></i>',
                'ai': '<i class="fas fa-robot"></i>',
                'query': '<i class="fas fa-database"></i>',
                'dashboard': '<i class="fas fa-chart-pie"></i>',
                'analyzing': '<i class="fas fa-search"></i>',
                'retry': '<i class="fas fa-redo"></i>',
                'error': '<i class="fas fa-exclamation-triangle"></i>',
                'llm_calls': '<i class="fas fa-bolt"></i>',
                'planning': '<i class="fas fa-route"></i>',
                'agent_step': '<i class="fas fa-cogs"></i>',
                'tool': '<i class="fas fa-wrench"></i>',
                'tool_call': '<i class="fas fa-tools"></i>',
                'resolving': '<i class="fas fa-search-plus"></i>',
                'entity_resolution': '<i class="fas fa-search-plus"></i>',
                'text_response_warning': '<i class="fas fa-comment-slash"></i>',
                'synthesizing': '<i class="fas fa-magic"></i>',
                'pre_resolution': '<i class="fas fa-tag"></i>'
            };
            return icons[step.type] || '<i class="fas fa-cog"></i>';
        },
        
        /**
         * Render rich content (tables, metrics, etc.)
         */
        renderRichContent: function(item) {
            if (item.type === 'table') {
                // Use AdvisorRenderer for all table rendering (income statements, grouped, etc.)
                return AdvisorRenderer.renderTable(item);
            }
            if (item.type === 'metric') {
                return this.renderMetric(item);
            }
            if (item.type === 'metrics') {
                // Metrics block with multiple items
                return this.renderMetricsBlock(item);
            }
            if (item.type === 'chart') {
                return this.renderChart(item);
            }
            if (item.type === 'sparkline') {
                return this.renderSparkline(item);
            }
            if (item.type === 'transaction_card') {
                return this.renderTransactionCard(item);
            }
            if (item.type === 'text') {
                // Text block - render as markdown
                return `<div class="response-text-block">${this.formatText(item.content || '')}</div>`;
            }
            if (item.type === 'callout') {
                // Callout block with variant
                const variant = item.variant || 'info';
                const icons = {
                    'info': 'fa-info-circle',
                    'warning': 'fa-exclamation-triangle',
                    'success': 'fa-check-circle',
                    'error': 'fa-times-circle'
                };
                const icon = icons[variant] || icons.info;
                return `<div class="advisor-callout callout-${variant}"><i class="fas ${icon}"></i> <div class="callout-content">${this.formatText(item.content || '')}</div></div>`;
            }
            if (item.type === 'group') {
                // Group of nested blocks
                let html = '<div class="block-group">';
                if (item.blocks && Array.isArray(item.blocks)) {
                    item.blocks.forEach(block => {
                        html += this.renderRichContent(block);
                    });
                }
                html += '</div>';
                return html;
            }
            if (item.type === 'warning') {
                return `<div class="advisor-alert warning"><i class="fas fa-exclamation-triangle"></i> ${this.escapeHtml(item.message || item.text || item.content)}</div>`;
            }
            if (item.type === 'success') {
                return `<div class="advisor-alert success"><i class="fas fa-check-circle"></i> ${this.escapeHtml(item.message || item.text || item.content)}</div>`;
            }
            if (item.type === 'error') {
                return `<div class="advisor-alert error"><i class="fas fa-times-circle"></i> ${this.escapeHtml(item.message || item.text || item.content)}</div>`;
            }
            if (item.type === 'heading') {
                const level = item.level || 2;
                const tag = `h${Math.min(Math.max(level, 1), 6)}`;
                return `<${tag} class="rich-heading">${this.escapeHtml(item.content || item.text || '')}</${tag}>`;
            }
            if (item.type === 'list') {
                let html = '<div class="rich-list">';
                if (item.title) {
                    html += `<div class="list-title">${this.escapeHtml(item.title)}</div>`;
                }
                html += '<ul class="rich-list-items">';
                if (item.items && Array.isArray(item.items)) {
                    item.items.forEach(li => {
                        html += `<li>${this.escapeHtml(String(li))}</li>`;
                    });
                }
                html += '</ul></div>';
                return html;
            }

            // Fallback: if item has content but no recognized type, render as text
            // This handles cases where type is missing or unknown
            if (item.content) {
                return `<div class="response-text-block">${this.formatText(item.content)}</div>`;
            }

            // Last resort: if item is a string, render it directly
            if (typeof item === 'string') {
                return `<div class="response-text-block">${this.formatText(item)}</div>`;
            }

            return '';
        },
        
        /**
         * Render a metrics block with multiple metrics
         */
        renderMetricsBlock: function(item) {
            if (!item.items || !Array.isArray(item.items)) return '';
            
            let html = '<div class="metrics-row">';
            item.items.forEach(metric => {
                // Pass through all metric properties (sparkline, delta, context, etc.)
                html += this.renderMetric({
                    type: 'metric',
                    label: metric.label,
                    value: metric.value,
                    format: metric.format || 'number',
                    sparkline: metric.sparkline,
                    delta: metric.delta,
                    deltaLabel: metric.deltaLabel,
                    trend: metric.trend,
                    context: metric.context,
                    suffix: metric.suffix
                });
            });
            html += '</div>';
            return html;
        },
        
        /**
         * Render a transaction card (for single transaction results)
         * Dynamically renders ALL properties from the data object
         */
        renderTransactionCard: function(item) {
            // Data can be in item.transaction (new format), item.data (legacy), or directly on item
            const data = item.transaction || item.data || item;
            
            // If data is still a wrapper object, we need to check for actual transaction data
            if (typeof data !== 'object' || data === null) {
                return '<div class="transaction-card"><div class="transaction-card-header">No transaction data</div></div>';
            }
            
            const type = item.transactionType || data.trantype || data.type || 'Transaction';
            const typeIcons = {
                'Invoice': 'fa-file-invoice-dollar',
                'Sales Order': 'fa-shopping-cart',
                'Purchase Order': 'fa-truck',
                'Bill': 'fa-file-invoice',
                'Vendor Bill': 'fa-file-invoice',
                'VendBill': 'fa-file-invoice',
                'Payment': 'fa-money-check-alt',
                'Vendor Payment': 'fa-money-check-alt',
                'Credit Memo': 'fa-receipt',
                'Estimate': 'fa-file-alt',
                'Journal': 'fa-book',
                'Transaction': 'fa-file'
            };
            const icon = typeIcons[type] || 'fa-file';
            
            // Fields to skip in dynamic rendering (internal, redundant, metadata, or already shown in header)
            const skipFields = new Set([
                'id', 'internalid', 'transaction_id',  // Used for deep link, not display
                'posting', 'voided',                    // Internal flags
                'trantype', 'type',                     // Already shown in header badge
                // Metadata fields from the wrapper object (not transaction data)
                'columns', 'formatting', 'title', 'transaction', 
                'data', 'templateformat', 'amount_formatted'
            ]);
            
            // Fields to show prominently in header area
            const headerFields = new Set(['tranid', 'document_number', 'entity', 'vendor_name', 'customer_name', 'amount', 'foreigntotal']);
            
            // Get display values for header
            const displayNumber = data.tranid || data.document_number || '';
            const displayEntity = data.entity || data.vendor_name || data.customer_name || '';
            const displayAmount = data.amount !== undefined ? data.amount : (data.foreigntotal !== undefined ? data.foreigntotal : null);
            
            let html = `<div class="transaction-card">`;
            html += `<div class="transaction-card-header">`;
            html += `<div class="transaction-type-badge"><i class="fas ${icon}"></i> ${this.escapeHtml(type)}</div>`;
            if (displayNumber) {
                html += `<div class="transaction-number">${this.escapeHtml(displayNumber)}</div>`;
            }
            html += `</div>`;
            
            // Primary info (entity and amount)
            if (displayEntity || displayAmount !== null) {
                html += `<div class="transaction-card-primary">`;
                if (displayEntity) {
                    html += `<div class="transaction-entity">${this.escapeHtml(displayEntity)}</div>`;
                }
                if (displayAmount !== null) {
                    html += `<div class="transaction-amount">${this.formatCurrency(displayAmount)}</div>`;
                }
                html += `</div>`;
            }
            
            // Details grid - render ALL other properties dynamically
            html += `<div class="transaction-card-details">`;
            
            // Collect remaining fields to display
            const displayFields = [];
            for (const [key, value] of Object.entries(data)) {
                const keyLower = key.toLowerCase();
                
                // Skip null/undefined, internal fields, and header fields
                if (value === null || value === undefined || value === '') continue;
                if (skipFields.has(keyLower)) continue;
                if (headerFields.has(keyLower)) continue;
                
                // Skip objects and arrays (these are metadata, not display values)
                if (typeof value === 'object') continue;
                
                displayFields.push({ key, value, keyLower });
            }
            
            // Sort fields: dates first, then status, then amounts, then alphabetical
            displayFields.sort((a, b) => {
                const order = (field) => {
                    if (field.keyLower.includes('date')) return 0;
                    if (field.keyLower === 'status') return 1;
                    if (field.keyLower.includes('amount') || field.keyLower.includes('unpaid') || field.keyLower.includes('due')) return 2;
                    return 3;
                };
                const orderDiff = order(a) - order(b);
                if (orderDiff !== 0) return orderDiff;
                return a.key.localeCompare(b.key);
            });
            
            // Render each field
            for (const field of displayFields) {
                const { key, value, keyLower } = field;
                const prettyLabel = this.prettifyColumnName(key);
                let displayValue = value;
                let extraClass = '';
                
                // Format based on field name and type
                if (keyLower === 'status') {
                    // Map NetSuite status codes to human-readable labels (fallback if backend didn't map)
                    const statusMap = {
                        'A': 'Pending Approval',
                        'B': 'Open',
                        'C': 'Closed',
                        'D': 'Cancelled',
                        'E': 'Fully Billed',
                        'F': 'Fulfilled',
                        'G': 'Pending Fulfillment',
                        'H': 'Partially Fulfilled',
                        'P': 'Paid In Full',
                        'V': 'Voided',
                        'R': 'Rejected'
                    };
                    const mappedStatus = (typeof value === 'string' && value.length === 1) ? (statusMap[value] || value) : value;
                    extraClass = this.getStatusClass(mappedStatus);
                    displayValue = `<span class="status-badge ${extraClass}">${this.escapeHtml(mappedStatus)}</span>`;
                } else if (keyLower.includes('date') || keyLower === 'trandate' || keyLower === 'duedate') {
                    displayValue = this.escapeHtml(this.formatDate(value));
                } else if (typeof value === 'number') {
                    // Numeric values - detect if currency
                    if (keyLower.includes('amount') || keyLower.includes('total') || 
                        keyLower.includes('price') || keyLower.includes('cost') ||
                        keyLower.includes('unpaid') || keyLower.includes('paid') ||
                        keyLower.includes('balance')) {
                        displayValue = this.formatCurrency(value);
                    } else if (value >= 0 && value <= 1 && keyLower.includes('rate')) {
                        displayValue = (value * 100).toFixed(1) + '%';
                    } else {
                        displayValue = value.toLocaleString();
                    }
                    displayValue = this.escapeHtml(String(displayValue));
                } else if (typeof value === 'string') {
                    // Check if it's a date string
                    if (value.match(/^\d{4}-\d{2}-\d{2}/)) {
                        displayValue = this.escapeHtml(this.formatDate(value));
                    } else if (value === 'T' || value === 'F') {
                        // Boolean flags
                        displayValue = value === 'T' ? 'Yes' : 'No';
                    } else {
                        displayValue = this.escapeHtml(value);
                    }
                } else {
                    displayValue = this.escapeHtml(String(value));
                }
                
                // Check if it's a long value (memo, notes, etc.)
                const isFullWidth = keyLower.includes('memo') || keyLower.includes('note') || 
                                   keyLower.includes('description') || String(value).length > 50;
                
                html += `<div class="transaction-detail${isFullWidth ? ' full-width' : ''}">`;
                html += `<span class="detail-label">${this.escapeHtml(prettyLabel)}</span>`;
                html += `<span class="detail-value">${displayValue}</span>`;
                html += `</div>`;
            }
            
            html += `</div>`; // details
            
            // Footer with NetSuite deep link - ONLY if numeric id exists
            const internalId = data.id;
            if (internalId && typeof internalId === 'number') {
                const nsUrl = `/app/accounting/transactions/transaction.nl?id=${internalId}`;
                html += `<div class="transaction-card-footer">`;
                html += `<a href="${nsUrl}" target="_blank" class="transaction-link">`;
                html += `<i class="fas fa-external-link-alt"></i> Open in NetSuite`;
                html += `</a>`;
                html += `<span class="transaction-id">ID: ${internalId}</span>`;
                html += `</div>`;
            }
            
            html += `</div>`; // card
            return html;
        },
        
        getNetSuiteRecordType: function(transactionType) {
            const typeMap = {
                'Invoice': 'custinvc',
                'Sales Order': 'salesord',
                'Purchase Order': 'purchord',
                'Vendor Bill': 'vendbill',
                'Bill': 'vendbill',
                'Payment': 'custpymt',
                'Vendor Payment': 'vendpymt',
                'Credit Memo': 'custcred',
                'Estimate': 'estimate',
                'Journal': 'journal',
                'Check': 'check',
                'Deposit': 'deposit',
                'Transfer': 'transfer'
            };
            return typeMap[transactionType] || 'transaction';
        },
        
        /**
         * Format date for display
         */
        formatDate: function(dateStr) {
            if (!dateStr) return '';
            try {
                const date = new Date(dateStr);
                return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            } catch (e) {
                return dateStr;
            }
        },
        
        /**
         * Get status CSS class
         */
        getStatusClass: function(status) {
            const statusLower = (status || '').toLowerCase();
            if (/paid|closed|complete|fulfilled|approved/.test(statusLower)) return 'status-success';
            if (/open|pending|partially/.test(statusLower)) return 'status-warning';
            if (/overdue|rejected|cancelled|void/.test(statusLower)) return 'status-error';
            return 'status-neutral';
        },
        
        /**
         * Prettify column name for display
         * Converts SNAKE_CASE, camelCase, and technical names to readable format
         */
        prettifyColumnName: function(col) {
            if (!col) return '';
            
            // Common abbreviation mappings
            const abbreviations = {
                'ar': 'AR',
                'ap': 'AP',
                'po': 'PO',
                'so': 'SO',
                'gl': 'GL',
                'ytd': 'YTD',
                'mtd': 'MTD',
                'qty': 'Qty',
                'avg': 'Avg',
                'pct': '%',
                'amt': 'Amount',
                'num': 'Number',
                'dt': 'Date',
                'id': 'ID',
                'cogs': 'COGS',
                'ebitda': 'EBITDA'
            };
            
            // Word replacements for common technical terms
            const replacements = {
                'tranid': 'Transaction #',
                'trandate': 'Date',
                'foreigntotal': 'Total',
                'foreignamountunpaid': 'Amount Due',
                'companyname': 'Company',
                'entityid': 'Entity ID',
                'accttype': 'Account Type',
                'accountsearchdisplayname': 'Account',
                'acctnumber': 'Account #',
                'netamount': 'Net Amount',
                'grossprofit': 'Gross Profit',
                'netprofit': 'Net Profit',
                'othincome': 'Other Income',
                'othexpense': 'Other Expense'
            };
            
            // Check for direct replacement first
            const colLower = col.toLowerCase();
            if (replacements[colLower]) {
                return replacements[colLower];
            }
            
            // Convert snake_case and SCREAMING_SNAKE_CASE to spaces
            let pretty = col.replace(/_/g, ' ');
            
            // Convert camelCase to spaces
            pretty = pretty.replace(/([a-z])([A-Z])/g, '$1 $2');
            
            // Lowercase everything first, then capitalize each word
            pretty = pretty.toLowerCase().split(' ').map(word => {
                // Check if it's a known abbreviation
                if (abbreviations[word]) {
                    return abbreviations[word];
                }
                // Capitalize first letter
                return word.charAt(0).toUpperCase() + word.slice(1);
            }).join(' ');
            
            // Clean up any double spaces
            pretty = pretty.replace(/\s+/g, ' ').trim();
            
            return pretty;
        },

        /**
         * Export table to CSV
         */
        exportCSV: function(tableId) {
            const data = this.tableData && this.tableData[tableId];
            if (!data) return;
            
            let csv = data.columns.join(',') + '\n';
            data.rows.forEach(row => {
                const values = data.columns.map(col => {
                    const key = col.toLowerCase().replace(/\s+/g, '_');
                    let val = row[key] !== undefined ? row[key] : (row[col] || '');
                    // Escape quotes and wrap in quotes if contains comma
                    val = String(val).replace(/"/g, '""');
                    if (val.includes(',') || val.includes('\n') || val.includes('"')) {
                        val = '"' + val + '"';
                    }
                    return val;
                });
                csv += values.join(',') + '\n';
            });
            
            // Download
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'export.csv';
            link.click();
            URL.revokeObjectURL(url);
        },
        
        /**
         * Copy table to clipboard
         */
        copyTable: function(tableId) {
            const data = this.tableData && this.tableData[tableId];
            if (!data) return;
            
            let text = data.columns.join('\t') + '\n';
            data.rows.forEach(row => {
                const values = data.columns.map(col => {
                    const key = col.toLowerCase().replace(/\s+/g, '_');
                    return row[key] !== undefined ? row[key] : (row[col] || '');
                });
                text += values.join('\t') + '\n';
            });
            
            navigator.clipboard.writeText(text).then(() => {
                // Show feedback
                const wrapper = document.getElementById(`${tableId}-wrapper`);
                const btn = wrapper && wrapper.querySelector('.table-action-btn:nth-child(2)');
                if (btn) {
                    const original = btn.innerHTML;
                    btn.innerHTML = '<i class="fas fa-check"></i>';
                    setTimeout(() => { btn.innerHTML = original; }, 2000);
                }
            });
        },
        
        /**
         * Format number based on column name
         */
        formatNumber: function(val, col) {
            const colLower = col.toLowerCase();
            
            const isCurrency = /amount|revenue|total|cost|price|balance|payment|invoice|sales|profit|cogs|expense|income/.test(colLower);
            const isNotCurrency = /hour|count|qty|quantity|days|rate|percent|pct|number|id|transaction/.test(colLower);
            
            if (isCurrency && !isNotCurrency) {
                return '$' + val.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
            }
            return val.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
        },
        
        /**
         * Format currency value
         */
        formatCurrency: function(val) {
            if (val === null || val === undefined) return '$0';
            const num = typeof val === 'number' ? val : parseFloat(val);
            if (isNaN(num)) return '$0';
            const isNegative = num < 0;
            const formatted = '$' + Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            return isNegative ? '-' + formatted : formatted;
        },
        
        /**
         * Render a metric card with optional delta/trend
         */
        renderMetric: function(item) {
            let valueStr = item.value;
            
            // Format value based on format type
            if (item.format === 'currency' && typeof item.value === 'number') {
                // Use compact format for large numbers
                if (Math.abs(item.value) >= 1000000) {
                    valueStr = '$' + (item.value / 1000000).toFixed(1) + 'M';
                } else if (Math.abs(item.value) >= 1000) {
                    valueStr = '$' + (item.value / 1000).toFixed(0) + 'k';
                } else {
                    valueStr = '$' + item.value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
                }
            } else if (item.format === 'percent' && typeof item.value === 'number') {
                valueStr = item.value.toFixed(1) + '%';
            } else if (typeof item.value === 'number') {
                valueStr = item.value.toLocaleString('en-US');
            }
            
            // Build delta/trend indicator
            let deltaHtml = '';
            if (item.delta !== undefined && item.delta !== null) {
                const isPositive = item.delta > 0 || item.trend === 'up';
                const icon = isPositive ? 'fa-arrow-up' : 'fa-arrow-down';
                const colorClass = isPositive ? 'trend-up' : 'trend-down';
                const sign = item.delta > 0 ? '+' : '';
                deltaHtml = `<span class="metric-delta ${colorClass}"><i class="fas ${icon}"></i> ${sign}${item.delta}%</span>`;
            }
            
            // Calculate font size based on label length
            const label = item.label || '';
            let labelClass = '';
            if (label.length > 30) {
                labelClass = 'metric-label-xs';
            } else if (label.length > 20) {
                labelClass = 'metric-label-sm';
            }
            
            // Build sparkline if provided
            let sparklineHtml = '';
            if (item.sparkline && Array.isArray(item.sparkline) && item.sparkline.length > 1) {
                const values = item.sparkline;
                const maxVal = Math.max(...values);
                const minVal = Math.min(...values);
                const range = maxVal - minVal || 1;
                const height = 24;
                // Use viewBox for responsive scaling - sparkline will stretch to full width
                const viewBoxWidth = 100;
                
                const points = values.map((v, i) => {
                    const x = (i / (values.length - 1 || 1)) * viewBoxWidth;
                    const y = height - ((v - minVal) / range) * height;
                    return `${x},${y}`;
                }).join(' ');
                
                sparklineHtml = `
                    <div class="metric-sparkline" style="width:100%;margin-top:8px;">
                        <svg width="100%" height="${height}" viewBox="0 0 ${viewBoxWidth} ${height}" preserveAspectRatio="none">
                            <polyline points="${points}" fill="none" stroke="#3b82f6" stroke-width="1.5"/>
                        </svg>
                    </div>
                `;
            }
            
            return `
                <div class="metric-card">
                    <div class="metric-value">${this.escapeHtml(String(valueStr))}</div>
                    <div class="metric-label ${labelClass}" title="${this.escapeHtml(label)}">${this.escapeHtml(label)}${deltaHtml}</div>
                    ${sparklineHtml}
                </div>
            `;
        },
        
        /**
         * Render a chart (bar, line, pie)
         */
        renderChart: function(item) {
            // Check for various data formats before rendering
            let hasData = false;
            if (Array.isArray(item.data) && item.data.length > 0) {
                hasData = true;
            } else if (item.data && item.data.labels && item.data.labels.length > 0) {
                // Chart.js format or { labels, values } format
                hasData = true;
            }
            
            if (!hasData) return '';
            
            const chartId = 'chart-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
            const chartType = item.chartType || 'bar';
            
            // Store chart config for later rendering
            if (!window.advisorCharts) window.advisorCharts = {};
            window.advisorCharts[chartId] = item;
            
            let html = `<div class="chart-container">`;
            if (item.title) {
                html += `<div class="chart-title">${this.escapeHtml(item.title)}</div>`;
            }
            html += `<div id="${chartId}" class="advisor-chart" data-chart-type="${chartType}"></div>`;
            html += `</div>`;
            
            // Defer chart rendering - try multiple times in case DOM isn't ready
            const self = this;
            const tryRender = function(attempt) {
                try {
                    const el = document.getElementById(chartId);
                    if (el) {
                        console.log('[Dashboard.Advisor] Chart container found on attempt', attempt);
                        self.renderChartElement(chartId, item);
                    } else if (attempt < 5) {
                        console.log('[Dashboard.Advisor] Chart container not found, retry', attempt + 1);
                        setTimeout(function() { tryRender(attempt + 1); }, 100);
                    } else {
                        console.error('[Dashboard.Advisor] Chart container never found:', chartId);
                    }
                } catch (err) {
                    console.error('[Dashboard.Advisor] Error in deferred chart render:', err);
                }
            };
            setTimeout(function() { tryRender(1); }, 50);
            
            return html;
        },
        
        /**
         * Actually render the chart element using simple SVG
         */
        renderChartElement: function(chartId, item) {
            console.log('[Dashboard.Advisor] renderChartElement called:', chartId, item);
            const container = document.getElementById(chartId);
            if (!container) {
                console.error('[Dashboard.Advisor] Chart container not found:', chartId);
                return;
            }
            
            let data = item.data;
            const chartType = item.chartType || 'bar';
            console.log('[Dashboard.Advisor] Chart type:', chartType, 'Raw data:', data);
            
            // Handle Chart.js format: { labels: [...], datasets: [{ data: [...] }] }
            if (data && !Array.isArray(data) && data.labels && data.datasets) {
                console.log('[Dashboard.Advisor] Converting Chart.js format');
                const labels = data.labels;
                const firstDataset = data.datasets[0] || {};
                const values = firstDataset.data || [];
                data = labels.map((label, i) => ({
                    label: label,
                    value: values[i] || 0
                }));
                console.log('[Dashboard.Advisor] Converted to array:', data.length, 'items');
            }
            
            // Handle object format: { labels: [...], values: [...] }
            if (data && !Array.isArray(data) && data.labels && data.values) {
                console.log('[Dashboard.Advisor] Converting labels/values format:', data);
                const labels = data.labels;
                const values = data.values;
                data = labels.map((label, i) => ({
                    label: label,
                    value: values[i] || 0
                }));
            }
            
            // Ensure data is an array at this point
            if (!Array.isArray(data)) {
                console.error('[Dashboard.Advisor] Chart data is not an array after conversion:', data);
                container.innerHTML = '<div class="chart-empty">Invalid chart data format</div>';
                return;
            }
            
            if (data.length === 0) {
                console.warn('[Dashboard.Advisor] Chart data array is empty');
                container.innerHTML = '<div class="chart-empty">No data available</div>';
                return;
            }
            
            // Auto-detect label and value fields if not explicitly provided
            // The AI might return { vendor: "...", increase: 123 } instead of { label: "...", value: 123 }
            // Also handle xKey/yKey (common AI output format)
            if (data && data.length > 0) {
                const firstItem = data[0];
                const keys = Object.keys(firstItem);
                
                // Find label field (string type, typically first)
                // Check multiple aliases: labelField, xField, xKey
                let labelField = item.labelField || item.xField || item.xKey || null;
                let valueField = item.valueField || item.yField || item.yKey || null;
                
                // Auto-detect if specified fields don't exist in data or weren't specified
                if (!labelField || !valueField || !(labelField in firstItem) || !(valueField in firstItem)) {
                    // Find the first string field as label, first number field as value
                    let detectedLabel = null;
                    let detectedValue = null;
                    for (const key of keys) {
                        if (typeof firstItem[key] === 'string' && !detectedLabel) {
                            detectedLabel = key;
                        }
                        if (typeof firstItem[key] === 'number' && !detectedValue) {
                            detectedValue = key;
                        }
                    }
                    
                    // Use detected fields if original fields don't exist in data
                    if (!labelField || !(labelField in firstItem)) {
                        labelField = detectedLabel || keys[0];
                    }
                    if (!valueField || !(valueField in firstItem)) {
                        valueField = detectedValue || keys[1];
                    }
                }
                
                // Normalize data to have label/value
                data = data.map(d => ({
                    label: d[labelField] || d.label || d.name || 'Unknown',
                    value: parseFloat(d[valueField]) || parseFloat(d.value) || parseFloat(d.amount) || 0,
                    originalData: d // Keep original for tooltips
                }));
            }
            
            // Simple SVG bar chart
            if (chartType === 'bar') {
                if (!data || data.length === 0) {
                    container.innerHTML = '<div class="chart-empty">No data available</div>';
                    return;
                }
                
                const maxVal = Math.max(...data.map(d => Math.abs(d.value)));
                const barHeight = 24;
                const padding = 4;
                const labelWidth = 120;
                const chartWidth = container.clientWidth || 400;
                const barWidth = chartWidth - labelWidth - 80;
                
                let svg = `<svg width="100%" height="${data.length * (barHeight + padding) + padding}" class="bar-chart">`;
                
                data.forEach((d, i) => {
                    const y = i * (barHeight + padding) + padding;
                    const width = maxVal > 0 ? (Math.abs(d.value) / maxVal) * barWidth : 0;
                    const color = d.value >= 0 ? 'var(--primary)' : 'var(--danger)';
                    const formattedVal = typeof d.value === 'number' 
                        ? (Math.abs(d.value) >= 1000 ? '$' + (d.value/1000).toFixed(1) + 'k' : '$' + d.value.toLocaleString())
                        : d.value;
                    const labelText = String(d.label || '').substring(0, 18);
                    
                    svg += `<text x="0" y="${y + barHeight/2 + 4}" class="bar-label">${this.escapeHtml(labelText)}</text>`;
                    svg += `<rect x="${labelWidth}" y="${y}" width="${Math.max(width, 2)}" height="${barHeight}" fill="${color}" rx="3"/>`;
                    svg += `<text x="${labelWidth + width + 5}" y="${y + barHeight/2 + 4}" class="bar-value">${formattedVal}</text>`;
                });
                
                svg += `</svg>`;
                container.innerHTML = svg;
            }
            // Simple pie chart
            else if (chartType === 'pie') {
                const total = data.reduce((sum, d) => sum + Math.abs(d.value), 0);
                const size = Math.min(container.clientWidth || 200, 200);
                const radius = size / 2 - 10;
                const cx = size / 2;
                const cy = size / 2;
                const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
                
                let svg = `<svg width="${size}" height="${size}" class="pie-chart">`;
                let startAngle = 0;
                
                data.forEach((d, i) => {
                    const sliceAngle = (Math.abs(d.value) / total) * 2 * Math.PI;
                    const endAngle = startAngle + sliceAngle;
                    const x1 = cx + radius * Math.cos(startAngle);
                    const y1 = cy + radius * Math.sin(startAngle);
                    const x2 = cx + radius * Math.cos(endAngle);
                    const y2 = cy + radius * Math.sin(endAngle);
                    const largeArc = sliceAngle > Math.PI ? 1 : 0;
                    const color = colors[i % colors.length];
                    
                    svg += `<path d="M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z" fill="${color}"/>`;
                    startAngle = endAngle;
                });
                
                svg += `</svg>`;
                
                // Add legend
                let legend = '<div class="pie-legend">';
                data.forEach((d, i) => {
                    const color = colors[i % colors.length];
                    const pct = total > 0 ? ((Math.abs(d.value) / total) * 100).toFixed(1) : 0;
                    legend += `<span class="legend-item"><span class="legend-color" style="background:${color}"></span>${this.escapeHtml(d.label)} (${pct}%)</span>`;
                });
                legend += '</div>';
                
                container.innerHTML = svg + legend;
            }
            // Line chart (simple)
            else if (chartType === 'line') {
                console.log('[Dashboard.Advisor] Rendering line chart with data:', data);
                try {
                    const maxVal = Math.max(...data.map(d => d.value));
                    const minVal = Math.min(...data.map(d => d.value));
                    const range = maxVal - minVal || 1;
                    const chartWidth = container.clientWidth || 300;
                    const chartHeight = 150;
                    const padding = 40;
                    const bottomPadding = 50; // Extra space for labels
                    
                    console.log('[Dashboard.Advisor] Line chart params:', { maxVal, minVal, range, chartWidth, chartHeight });
                    
                    const points = data.map((d, i) => {
                        const x = padding + (i / (data.length - 1 || 1)) * (chartWidth - 2 * padding);
                        const y = chartHeight - bottomPadding - ((d.value - minVal) / range) * (chartHeight - padding - bottomPadding);
                        return `${x},${y}`;
                    }).join(' ');
                    
                    let svg = `<svg width="100%" height="${chartHeight}" viewBox="0 0 ${chartWidth} ${chartHeight}" class="line-chart">`;
                    svg += `<polyline points="${points}" fill="none" stroke="var(--primary)" stroke-width="2"/>`;
                    
                    // Add dots and X-axis labels
                    data.forEach((d, i) => {
                        const x = padding + (i / (data.length - 1 || 1)) * (chartWidth - 2 * padding);
                        const y = chartHeight - bottomPadding - ((d.value - minVal) / range) * (chartHeight - padding - bottomPadding);
                        svg += `<circle cx="${x}" cy="${y}" r="4" fill="var(--primary)"/>`;
                        
                        // Add X-axis labels (show every nth label to avoid crowding)
                        const showLabel = data.length <= 6 || i % Math.ceil(data.length / 6) === 0 || i === data.length - 1;
                        if (showLabel) {
                            const labelText = String(d.label || '').substring(0, 8);
                            svg += `<text x="${x}" y="${chartHeight - 10}" text-anchor="middle" class="chart-label" font-size="10">${this.escapeHtml(labelText)}</text>`;
                        }
                    });
                    
                    svg += `</svg>`;
                    console.log('[Dashboard.Advisor] Line chart SVG length:', svg.length);
                    container.innerHTML = svg;
                } catch (lineErr) {
                    console.error('[Dashboard.Advisor] Line chart error:', lineErr);
                    container.innerHTML = '<div class="chart-empty">Error rendering chart</div>';
                }
            }
        },
        
        /**
         * Render a sparkline
         */
        renderSparkline: function(item) {
            if (!item.data || item.data.length === 0) return '';
            
            const values = item.data;
            const maxVal = Math.max(...values);
            const minVal = Math.min(...values);
            const range = maxVal - minVal || 1;
            const width = 80;
            const height = 20;
            
            const points = values.map((v, i) => {
                const x = (i / (values.length - 1 || 1)) * width;
                const y = height - ((v - minVal) / range) * height;
                return `${x},${y}`;
            }).join(' ');
            
            return `
                <span class="sparkline-container">
                    ${item.label ? `<span class="sparkline-label">${this.escapeHtml(item.label)}</span>` : ''}
                    <svg width="${width}" height="${height}" class="sparkline">
                        <polyline points="${points}" fill="none" stroke="var(--primary)" stroke-width="1.5"/>
                    </svg>
                </span>
            `;
        },
        
        /**
         * Render all messages from session
         */
        renderAllMessages: function() {
            if (messages.length === 0) return;

            // Hide health scores when restoring session with messages
            const healthScores = document.getElementById('health-scores-overview');
            if (healthScores) healthScores.classList.add('hidden');

            const welcome = document.getElementById('advisor-welcome-full');
            if (welcome) welcome.style.display = 'none';

            // Track last user query for older messages without userQuery stored
            let lastUserQuery = '';
            messages.forEach(msg => {
                if (msg.role === 'user') {
                    lastUserQuery = msg.content;
                } else if (msg.role === 'assistant' && !msg.userQuery) {
                    // Backfill userQuery for older messages
                    msg.userQuery = lastUserQuery;
                }
                this.renderMessage(msg);
            });
            this.scrollToBottom();
        },
        
        /**
         * Scroll chat to bottom
         */
        scrollToBottom: function() {
            const container = document.getElementById('advisor-messages-full');
            if (container) {
                requestAnimationFrame(() => {
                    container.scrollTop = container.scrollHeight;
                });
            }
        },
        
        /**
         * Clear chat history
         */
        clearChat: function() {
            messages = [];
            sessionContext = {
                resolvedEntities: {},
                entityOrder: [],
                topics: [],
                queryHistory: []
            };  // Reset entity cache and context

            // Clear stored table data to free memory
            if (window.Gantry?.AdvisorRenderer?.clearTableData) {
                window.Gantry.AdvisorRenderer.clearTableData();
            }

            this.saveSession();

            const container = document.getElementById('advisor-messages-full');
            if (container) {
                // Keep only the welcome/command center
                const welcome = container.querySelector('.command-center') || container.querySelector('.advisor-hero');
                container.innerHTML = '';
                if (welcome) {
                    container.appendChild(welcome);
                    welcome.style.display = '';
                }
            }

            // Show health scores again
            const healthScores = document.getElementById('health-scores-overview');
            if (healthScores) healthScores.classList.remove('hidden');

            // Show command center / welcome
            const commandCenter = document.getElementById('advisor-welcome-full');
            if (commandCenter) commandCenter.style.display = '';

            // Reset and restart the geometric animation
            GeometricAnimation.cleanup();
            // Reset canvas opacity
            const canvas = document.getElementById('geometric-canvas');
            if (canvas) canvas.style.opacity = '1';
            // Small delay then restart animation
            setTimeout(() => {
                GeometricAnimation.init();
            }, 100);

            // Reset score-category cards visibility for animation replay
            const scoreCategories = document.getElementById('score-categories');
            if (scoreCategories) {
                scoreCategories.classList.remove('cards-visible');
            }

            // Re-bind suggestion chip events
            this.bindEvents();
        },
        
        /**
         * Save session to storage
         * - Chat history goes to localStorage (persists across page reloads)
         * - Active request goes to sessionStorage (only persists during navigation)
         */
        saveSession: function() {
            try {
                // Save chat history to localStorage (persists across reloads)
                const historyData = {
                    messages: messages.slice(-MAX_HISTORY),
                    sessionContext: sessionContext,
                    timestamp: Date.now()
                };
                localStorage.setItem(STORAGE_KEY, JSON.stringify(historyData));

                // Save active request to sessionStorage (cleared on page reload)
                if (activeRequest) {
                    sessionStorage.setItem(ACTIVE_REQUEST_KEY, JSON.stringify(activeRequest));
                } else {
                    sessionStorage.removeItem(ACTIVE_REQUEST_KEY);
                }
            } catch (e) {
                console.warn('[Advisor] Save failed:', e);
            }
        },

        /**
         * Load session from storage
         */
        loadSession: function() {
            try {
                // Load chat history from localStorage
                const historyData = localStorage.getItem(STORAGE_KEY);
                if (historyData) {
                    const parsed = JSON.parse(historyData);
                    messages = parsed.messages || [];
                    sessionContext = parsed.sessionContext || {};
                    sessionContext.resolvedEntities = sessionContext.resolvedEntities || {};
                    sessionContext.entityOrder = sessionContext.entityOrder || [];
                    sessionContext.topics = sessionContext.topics || [];
                    sessionContext.queryHistory = sessionContext.queryHistory || [];
                }

                // Load active request from sessionStorage (only present during same-page navigation)
                const activeData = sessionStorage.getItem(ACTIVE_REQUEST_KEY);
                activeRequest = activeData ? JSON.parse(activeData) : null;
            } catch (e) {
                messages = [];
                sessionContext = {
                    resolvedEntities: {},
                    entityOrder: [],
                    topics: [],
                    queryHistory: []
                };
                activeRequest = null;
            }
        },
        
        /**
         * Format text with basic markdown support (headers, bold, italic, lists)
         * Note: Tables are extracted by backend and rendered as richContent
         */
        formatText: function(text) {
            if (!text) return '';
            
            // Strip Cohere citation tags: <co>text</co: 0:[...]> -> text
            text = text.replace(/<co>([^<]*)<\/co:[^>]*>/g, '$1');
            
            // Escape HTML first
            let html = text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
            
            // Headers (### Header -> <h4>, ## Header -> <h3>)
            html = html.replace(/^### (.+)$/gm, '<h4 class="md-heading">$1</h4>');
            html = html.replace(/^## (.+)$/gm, '<h3 class="md-heading">$1</h3>');
            html = html.replace(/^# (.+)$/gm, '<h2 class="md-heading">$1</h2>');
            
            // Bold and italic
            html = html.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
            html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
            
            // Inline code
            html = html.replace(/`(.*?)`/g, '<code class="md-code">$1</code>');
            
            // Unordered lists (- item or * item at start of line)
            // Convert list items
            html = html.replace(/^[\-\*]\s+(.+)$/gm, '<li>$1</li>');
            // Wrap consecutive <li> in <ul>
            html = html.replace(/(<li>.*<\/li>\n?)+/g, function(match) {
                return '<ul class="md-list">' + match + '</ul>';
            });
            
            // Numbered lists
            html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');
            
            // Line breaks - but NOT inside lists
            html = html.replace(/\n/g, '<br>');
            
            // Clean up extra <br> around block elements
            html = html.replace(/<br>\s*(<h[234]|<ul|<\/ul|<\/h[234]>)/g, '$1');
            html = html.replace(/(<\/h[234]>|<\/ul>)\s*<br>/g, '$1');
            
            // Clean up <br> between list items (inside <ul>)
            html = html.replace(/<\/li><br>\s*<li>/g, '</li><li>');
            html = html.replace(/<\/li><br>\s*<\/ul>/g, '</li></ul>');
            html = html.replace(/<ul class="md-list"><br>/g, '<ul class="md-list">');
            
            return html;
        },
        
        /**
         * Copy response to clipboard
         */
        copyResponse: function(msgId) {
            const msgEl = document.getElementById(msgId);
            if (!msgEl) return;
            
            const bubble = msgEl.closest('.message-bubble');
            if (!bubble) return;
            
            // Get text content (skip action buttons)
            const textEl = bubble.querySelector('.message-text');
            const text = textEl ? textEl.textContent : '';
            
            navigator.clipboard.writeText(text).then(() => {
                // Show feedback
                const btn = msgEl.querySelector('.action-btn');
                if (btn) {
                    const original = btn.innerHTML;
                    btn.innerHTML = '<i class="fas fa-check"></i> Copied';
                    btn.classList.add('copy-success');
                    setTimeout(() => {
                        btn.innerHTML = original;
                        btn.classList.remove('copy-success');
                    }, 2000);
                }
            });
        },
        
        /**
         * Print response (opens print dialog for PDF save)
         */
        printResponse: function(msgId) {
            const msgEl = document.getElementById(msgId);
            if (!msgEl) return;
            
            const bubble = msgEl.closest('.message-bubble');
            if (!bubble) return;
            
            // Create print-friendly version
            const printContent = bubble.cloneNode(true);
            
            // Remove action buttons from print version
            const actions = printContent.querySelector('.response-actions');
            if (actions) actions.remove();
            
            // Open print window
            const printWindow = window.open('', '_blank');
            printWindow.document.write(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Advisor Response</title>
                    <style>
                        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; }
                        table { border-collapse: collapse; width: 100%; margin: 16px 0; }
                        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                        th { background: #f5f5f5; }
                        .model-badge { display: none; }
                        @media print { body { padding: 20px; } }
                    </style>
                </head>
                <body>${printContent.innerHTML}</body>
                </html>
            `);
            printWindow.document.close();
            printWindow.print();
        },
        
        /**
         * Escape HTML entities
         */
        escapeHtml: function(text) {
            if (text === null || text === undefined) return '';
            const div = document.createElement('div');
            div.textContent = String(text);
            return div.innerHTML;
        }
    };

    // Register with router
    if (window.Router) {
        Router.register('advisor', 
            () => AdvisorController.init(),
            () => AdvisorController.cleanup()
        );
    }

    // Export
    window.AdvisorController = AdvisorController;
    window.AdvisorChat = AdvisorController; // Alias for onclick handlers

})(window);