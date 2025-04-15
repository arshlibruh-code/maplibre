import {type Handler} from '../handler_manager';
import type {Map} from '../map';
import {TransformProvider} from './transform-provider';

const defaultOptions = {
    panStep: 100,
    bearingStep: 15,
    pitchStep: 10
};

// Speed multiplier conversion helpers
function panSpeedFromSlider(sliderValue: number): number {
    // Convert slider value 1-10 to pan speed 1-6 in 0.5 steps
    return 1 + (sliderValue - 1) * (5 / 9);
}

function rotationSpeedFromSlider(sliderValue: number): number {
    // Convert slider value 1-10 to rotation speed 1-10
    return sliderValue;
}

function pitchSpeedFromSlider(sliderValue: number): number {
    // Convert slider value 1-10 to pitch speed 1-10
    return sliderValue;
}

function zoomSpeedFromSlider(sliderValue: number): number {
    // Convert slider value 1-10 to zoom speed 1-10
    return sliderValue;
}

/**
 * The `KeyboardHandler` allows the user to zoom, rotate, and pan the map using
 * the following keyboard shortcuts:
 *
 * - `=` / `+`: Increase the zoom level by 1.
 * - `Shift-=` / `Shift-+`: Increase the zoom level by 2.
 * - `-`: Decrease the zoom level by 1.
 * - `Shift--`: Decrease the zoom level by 2.
 * - Arrow keys: Pan by 100 pixels.
 * - `Shift+⇢`: Increase the rotation by 15 degrees.
 * - `Shift+⇠`: Decrease the rotation by 15 degrees.
 * - `Shift+⇡`: Increase the pitch by 10 degrees.
 * - `Shift+⇣`: Decrease the pitch by 10 degrees.
 *
 * @group Handlers
 */
export class KeyboardHandler implements Handler {
    _tr: TransformProvider;
    _enabled: boolean;
    _active: boolean;
    _panStep: number;
    _bearingStep: number;
    _pitchStep: number;
    _rotationDisabled: boolean;
    _map: Map;
    _keysDown: {[key: number]: boolean};
    _keyHoldTimer: {[key: number]: number};
    _animationFrameId: number | null;
    _panSpeed: number;
    _rotationSpeed: number;
    _pitchSpeed: number;
    _zoomSpeed: number;

    /** @internal */
    constructor(map: Map) {
        this._tr = new TransformProvider(map);
        this._map = map;
        const stepOptions = defaultOptions;
        this._panStep = stepOptions.panStep;
        this._bearingStep = stepOptions.bearingStep;
        this._pitchStep = stepOptions.pitchStep;
        this._rotationDisabled = false;
        this._keysDown = {};
        this._keyHoldTimer = {};
        this._animationFrameId = null;
        
        // Default speed settings (middle of range)
        this._panSpeed = panSpeedFromSlider(5);         // Default to 5 on a 1-10 slider (3.5 in 1-6 range)
        this._rotationSpeed = rotationSpeedFromSlider(5); // Default to 5 on a 1-10 slider
        this._pitchSpeed = pitchSpeedFromSlider(5);     // Default to 5 on a 1-10 slider
        this._zoomSpeed = zoomSpeedFromSlider(5);       // Default to 5 on a 1-10 slider
        
        // Bind methods to this instance
        this._onKeyDown = this._onKeyDown.bind(this);
        this._onKeyUp = this._onKeyUp.bind(this);
        this._onBlur = this._onBlur.bind(this);
        this._continuousMovementFrame = this._continuousMovementFrame.bind(this);
        
        // Event listeners are added in enable() method
        console.log('KeyboardHandler initialized');
    }

    /**
     * Set the pan speed using a slider value from 1-10
     * 
     * @param sliderValue A value between 1 and 10
     */
    setPanSpeed(sliderValue: number) {
        this._panSpeed = panSpeedFromSlider(Math.max(1, Math.min(10, sliderValue)));
    }

    /**
     * Set the rotation speed using a slider value from 1-10
     * 
     * @param sliderValue A value between 1 and 10
     */
    setRotationSpeed(sliderValue: number) {
        this._rotationSpeed = rotationSpeedFromSlider(Math.max(1, Math.min(10, sliderValue)));
    }

    /**
     * Set the pitch speed using a slider value from 1-10
     * 
     * @param sliderValue A value between 1 and 10
     */
    setPitchSpeed(sliderValue: number) {
        this._pitchSpeed = pitchSpeedFromSlider(Math.max(1, Math.min(10, sliderValue)));
    }

    /**
     * Set the zoom speed using a slider value from 1-10
     * 
     * @param sliderValue A value between 1 and 10
     */
    setZoomSpeed(sliderValue: number) {
        this._zoomSpeed = zoomSpeedFromSlider(Math.max(1, Math.min(10, sliderValue)));
    }

    _onKeyDown = (e: KeyboardEvent) => {
        if (!this._enabled) {
            console.log('Keyboard controls disabled, skipping keydown');
            return;
        }
        
        if (e.altKey || e.ctrlKey || e.metaKey) {
            return;
        }
        
        // Check for key code or key value
        const keyCode = this._getKeyCode(e);
        console.log(`Key pressed: ${e.key} (keyCode: ${keyCode})`);
        
        // Only process keys we care about
        if (!this._isRelevantKey(keyCode)) {
            return;
        }
        
        // Prevent default behavior for navigation keys
        e.preventDefault();
        
        // Mark the key as pressed if it wasn't already
        if (!this._keysDown[keyCode]) {
            this._keysDown[keyCode] = true;
            console.log(`Active keys: ${Object.keys(this._keysDown).join(', ')}`);
            
            // For first press, immediately respond with a quick tap
            this._handleKeyTap(keyCode, false);
            
            // Start timer for this key to detect hold
            this._keyHoldTimer[keyCode] = window.setTimeout(() => {
                // Start continuous movement if the key is still down after the timer
                if (this._keysDown[keyCode] && !this._animationFrameId) {
                    console.log(`Starting continuous movement for key: ${keyCode}`);
                    this._startContinuousMovement();
                }
            }, 200); // 200ms hold time before continuous movement starts
        }
    };
    
    _onKeyUp = (e: KeyboardEvent) => {
        // Check for key code or key value
        const keyCode = this._getKeyCode(e);
        
        if (this._keysDown[keyCode]) {
            // Clear key hold timer
            if (this._keyHoldTimer[keyCode]) {
                clearTimeout(this._keyHoldTimer[keyCode]);
                delete this._keyHoldTimer[keyCode];
            }
            
            // Mark key as released
            delete this._keysDown[keyCode];
            
            // If no keys are pressed anymore, stop continuous movement
            if (Object.keys(this._keysDown).length === 0 && this._animationFrameId) {
                this._stopContinuousMovement();
            }
        }
    };
    
    _onBlur = () => {
        // Clear all keys when window loses focus
        this._keysDown = {};
        Object.keys(this._keyHoldTimer).forEach(key => {
            clearTimeout(this._keyHoldTimer[parseInt(key)]);
        });
        this._keyHoldTimer = {};
        
        if (this._animationFrameId) {
            this._stopContinuousMovement();
        }
    };
    
    _isRelevantKey(keyCode: number): boolean {
        return [
            // WASD keys
            87, 65, 83, 68,
            // QE for rotation
            81, 69,
            // RF for pitch
            82, 70,
            // ZX for zoom
            90, 88
        ].includes(keyCode);
    }
    
    _handleKeyTap(keyCode: number, shiftKey: boolean) {
        let zoomDir = 0;
        let bearingDir = 0;
        let pitchDir = 0;
        let xDir = 0;
        let yDir = 0;

        switch (keyCode) {
            case 90: // Z key
                zoomDir = 1;
                break;

            case 88: // X key
                zoomDir = -1;
                break;

            case 65: // A key
                xDir = -1;
                break;

            case 68: // D key
                xDir = 1;
                break;

            case 87: // W key
                yDir = -1;
                break;

            case 83: // S key
                yDir = 1;
                break;
                
            case 81: // Q key
                bearingDir = -1;
                break;
                
            case 69: // E key
                bearingDir = 1;
                break;
                
            case 82: // R key
                pitchDir = 1;
                break;
                
            case 70: // F key
                pitchDir = -1;
                break;
        }

        if (this._rotationDisabled) {
            bearingDir = 0;
            pitchDir = 0;
        }

        const tr = this._tr;
        this._map.easeTo({
            duration: 300,
            easeId: 'keyboardHandler',
            easing: easeOutQuint,
            zoom: zoomDir ? Math.round(tr.zoom) + zoomDir : tr.zoom,
            bearing: tr.bearing + bearingDir * this._bearingStep,
            pitch: tr.pitch + pitchDir * this._pitchStep,
            offset: [-xDir * this._panStep, -yDir * this._panStep],
            center: tr.center
        });
    }
    
    _startContinuousMovement() {
        this._active = true;
        this._animationFrameId = window.requestAnimationFrame(this._continuousMovementFrame);
    }
    
    _stopContinuousMovement() {
        this._active = false;
        if (this._animationFrameId) {
            window.cancelAnimationFrame(this._animationFrameId);
            this._animationFrameId = null;
        }
    }
    
    _continuousMovementFrame = () => {
        // Calculate movement based on currently pressed keys
        let zoomDir = 0;
        let bearingDir = 0;
        let pitchDir = 0;
        let xDir = 0;
        let yDir = 0;
        
        console.log(`Continuous frame with keys: ${Object.keys(this._keysDown).join(', ')}`);
        
        // Check each possible key
        Object.keys(this._keysDown).forEach(keyCodeStr => {
            const keyCode = parseInt(keyCodeStr);
            
            switch (keyCode) {
                case 90: // Z key
                    zoomDir += 0.01 * this._zoomSpeed;
                    break;
                case 88: // X key
                    zoomDir -= 0.01 * this._zoomSpeed;
                    break;
                case 65: // A key
                    xDir -= 0.5 * this._panSpeed;
                    break;
                case 68: // D key
                    xDir += 0.5 * this._panSpeed;
                    break;
                case 87: // W key
                    yDir -= 0.5 * this._panSpeed;
                    break;
                case 83: // S key
                    yDir += 0.5 * this._panSpeed;
                    break;
                case 81: // Q key
                    bearingDir -= 0.1 * this._rotationSpeed;
                    break;
                case 69: // E key
                    bearingDir += 0.1 * this._rotationSpeed;
                    break;
                case 82: // R key
                    pitchDir += 0.1 * this._pitchSpeed;
                    break;
                case 70: // F key
                    pitchDir -= 0.1 * this._pitchSpeed;
                    break;
            }
        });
        
        if (this._rotationDisabled) {
            bearingDir = 0;
            pitchDir = 0;
        }
        
        // Log movement values
        if (xDir !== 0 || yDir !== 0 || zoomDir !== 0 || bearingDir !== 0 || pitchDir !== 0) {
            console.log(`Movement: x=${xDir.toFixed(2)}, y=${yDir.toFixed(2)}, zoom=${zoomDir.toFixed(2)}, bearing=${bearingDir.toFixed(2)}, pitch=${pitchDir.toFixed(2)}`);
        }
        
        // Apply movement if any
        if (zoomDir !== 0 || bearingDir !== 0 || pitchDir !== 0 || xDir !== 0 || yDir !== 0) {
            const tr = this._tr;
            
            // For continuous movement, use easeTo with short duration for smooth motion
            this._map.easeTo({
                duration: 100,
                easing: easeOutQuint,
                zoom: tr.zoom + zoomDir,
                bearing: tr.bearing + bearingDir,
                pitch: tr.pitch + pitchDir,
                center: tr.center,
                offset: [-xDir, -yDir]
            });
        }
        
        // Continue animation if there are still keys pressed
        if (Object.keys(this._keysDown).length > 0) {
            this._animationFrameId = window.requestAnimationFrame(this._continuousMovementFrame);
        } else {
            console.log('No keys pressed, stopping continuous movement');
            this._stopContinuousMovement();
        }
    };

    keydown(e: KeyboardEvent) {
        // This method is kept for backward compatibility
        // The actual handling is done in _onKeyDown
        return;
    }

    reset() {
        this._active = false;
        this._keysDown = {};
        Object.keys(this._keyHoldTimer).forEach(key => {
            clearTimeout(this._keyHoldTimer[parseInt(key)]);
        });
        this._keyHoldTimer = {};
        
        if (this._animationFrameId) {
            this._stopContinuousMovement();
        }
    }

    /**
     * Enables the "keyboard rotate and zoom" interaction.
     *
     * @example
     * ```ts
     * map.keyboard.enable();
     * ```
     */
    enable() {
        this._enabled = true;
        console.log('Keyboard controls enabled');
        
        // Event listeners are added in enable() method
        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);
        window.addEventListener('blur', this._onBlur);
    }

    /**
     * Disables the "keyboard rotate and zoom" interaction.
     *
     * @example
     * ```ts
     * map.keyboard.disable();
     * ```
     */
    disable() {
        this._enabled = false;
        this.reset();
        console.log('Keyboard controls disabled');
        
        // Event listeners are removed in disable() method
        window.removeEventListener('keydown', this._onKeyDown);
        window.removeEventListener('keyup', this._onKeyUp);
        window.removeEventListener('blur', this._onBlur);
    }

    /**
     * Returns a Boolean indicating whether the "keyboard rotate and zoom"
     * interaction is enabled.
     *
     * @returns `true` if the "keyboard rotate and zoom"
     * interaction is enabled.
     */
    isEnabled() {
        return this._enabled;
    }

    /**
     * Returns true if the handler is enabled and has detected the start of a
     * zoom/rotate gesture.
     *
     * @returns `true` if the handler is enabled and has detected the
     * start of a zoom/rotate gesture.
     */
    isActive() {
        return this._active;
    }

    /**
     * Disables the "keyboard pan/rotate" interaction, leaving the
     * "keyboard zoom" interaction enabled.
     *
     * @example
     * ```ts
     * map.keyboard.disableRotation();
     * ```
     */
    disableRotation() {
        this._rotationDisabled = true;
    }

    /**
     * Enables the "keyboard pan/rotate" interaction.
     *
     * @example
     * ```ts
     * map.keyboard.enable();
     * map.keyboard.enableRotation();
     * ```
     */
    enableRotation() {
        this._rotationDisabled = false;
    }

    // Helper function to get a consistent key identifier
    _getKeyCode(e: KeyboardEvent): number {
        // For WASD and other special keys, use the key value for better compatibility
        const key = e.key.toLowerCase();
        if (key === 'w') return 87;
        if (key === 'a') return 65;
        if (key === 's') return 83;
        if (key === 'd') return 68;
        if (key === 'q') return 81;
        if (key === 'e') return 69;
        if (key === 'r') return 82;
        if (key === 'f') return 70;
        if (key === 'z') return 90;
        if (key === 'x') return 88;
        
        // Default to key code (for space and other keys)
        return e.keyCode;
    }
}

function easeOut(t: number) {
    return t * (2 - t);
}

function easeOutQuint(t: number) {
    return 1 - Math.pow(1 - t, 5);
}
