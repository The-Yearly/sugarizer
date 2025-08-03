define([
	"sugar-web/activity/activity",
	"sugar-web/env",
	"sugar-web/graphics/presencepalette",
	"activity/palettes/speedpalette",
	"activity/palettes/templatepalette",
	"tutorial",
	"l10n"
], function (
	activity,
	env,
	presencepalette,
	speedpalette,
	templatepalette,
	tutorial,
	l10n
) {
	// Manipulate the DOM only when it is ready.
	requirejs(['domReady!'], function (doc) {

		// STATE VARIABLES
		let canvas, ctx;

		let baseFrames = {}; 	// Store first frame with absolute positions for each stickman
		let deltaFrames = {}; 	// Store relative movement deltas for subsequent frames
		let stickmen = []; 		// Array of stickmen (current working positions)

		let currentFrameIndices = {}; 
		let isPlaying = false;
		let speed = 1;
		let selectedJoint = null;
		let selectedStickmanIndex = -1;
		let isDragging = false;
		let isDraggingWhole = false;
		let templates = {};
		let currentSpeed = 1;
		let dragStartPos = { x: 0, y: 0 };
		let originalJoints = [];
		let nextStickmanId = 0;
		let isRemovalMode = false;
		let currentenv;
		let isShared = false;
		let isRotating = false;
		let rotationPivot = null;
		let rotationStartAngle = 0;
		let neckManuallyMoved = false; 

		// PRESENCE VARIABLES
		let presence = null;
		let isHost = false;

		// UTILITY FUNCTIONS
		
		function deepClone(obj) {
			return JSON.parse(JSON.stringify(obj));
		} 

		// Joint hierarchy - defines parent-child relationships for rotation
		const jointHierarchy = {
			2: [11], 		// hip -> middle
			11: [1], 		// middle -> body (neck rotates around middle)
			1: [0, 7, 9], 	// body -> head, left elbow, right elbow
			7: [8], 		// left elbow -> left hand
			9: [10], 		// right elbow -> right hand
			3: [4], 		// left knee -> left foot
			5: [6]			// right knee -> right foot
		};

		// Joint connections with proper distances
		const jointConnections = [
			{ from: 0, to: 1, length: 20 },    // head to body 
			{ from: 1, to: 11, length: 30 },   // body to middle
			{ from: 11, to: 2, length: 30 },   // middle to hips
			{ from: 2, to: 3, length: 40 },    // hips to left knee
			{ from: 3, to: 4, length: 40 },    // left knee to foot
			{ from: 2, to: 5, length: 40 },    // hips to right knee
			{ from: 5, to: 6, length: 40 },    // right knee to foot
			{ from: 1, to: 7, length: 40 },    // body to left elbow
			{ from: 7, to: 8, length: 30 },    // left elbow to hand
			{ from: 1, to: 9, length: 40 },    // body to right elbow
			{ from: 9, to: 10, length: 30 }    // right elbow to hand
		];

		// DELTA FRAME SYSTEM FUNCTIONS

		function calculateDeltas(currentJoints, previousJoints) {
			if (!previousJoints || currentJoints.length !== previousJoints.length) {
				return null;
			}
			
			// Create a copy of current joints and enforce constraints
			const constrainedJoints = deepClone(currentJoints);
			enforceJointDistances(constrainedJoints);
			
			return constrainedJoints.map((joint, index) => ({
				dx: joint.x - previousJoints[index].x,
				dy: joint.y - previousJoints[index].y,
				name: joint.name
			}));
		}

		function applyDeltas(baseJoints, deltas) {
			if (!deltas || baseJoints.length !== deltas.length) {
				return deepClone(baseJoints);
			}
			
			const newJoints = baseJoints.map((joint, index) => ({
				x: joint.x + deltas[index].dx,
				y: joint.y + deltas[index].dy,
				name: joint.name
			}));
			
			// Apply distance constraints to maintain limb lengths
			enforceJointDistances(newJoints);
			
			return newJoints;
		}

		function enforceJointDistances(joints) {
			// Apply joint distance constraints with a hierarchical approach
			// Start from the root (hips) and work outward to maintain stability
			const processOrder = [
				{ from: 2, to: 11 },   // hips to middle
				{ from: 11, to: 1 },   // middle to body  
				{ from: 1, to: 0 },    // body to head
				{ from: 1, to: 7 },    // body to left elbow
				{ from: 7, to: 8 },    // left elbow to left hand
				{ from: 1, to: 9 },    // body to right elbow
				{ from: 9, to: 10 },   // right elbow to right hand
				{ from: 2, to: 3 },    // hips to left knee
				{ from: 3, to: 4 },    // left knee to left foot
				{ from: 2, to: 5 },    // hips to right knee
				{ from: 5, to: 6 }     // right knee to right foot
			];
			
			// Apply constraints in hierarchical order
			for (let iteration = 0; iteration < 2; iteration++) {
				processOrder.forEach(conn => {
					const joint1 = joints[conn.from];
					const joint2 = joints[conn.to];
					
					if (!joint1 || !joint2) return;
					
					const dx = joint2.x - joint1.x;
					const dy = joint2.y - joint1.y;
					const currentDistance = Math.sqrt(dx * dx + dy * dy);
					const targetDistance = jointConnections.find(jc => jc.from === conn.from && jc.to === conn.to)?.length;
					
					if (targetDistance && currentDistance > 0 && Math.abs(currentDistance - targetDistance) > 0.5) {
						const ratio = targetDistance / currentDistance;
						const newX = joint1.x + dx * ratio;
						const newY = joint1.y + dy * ratio;
						
						// Move the child joint to maintain distance from parent
						joint2.x = newX;
						joint2.y = newY;
					}
				});
			}
		}

		function reconstructFrameFromDeltas(stickmanId, frameIndex) {
			if (!baseFrames[stickmanId] || frameIndex < 0) {
				return null;
			}
			
			if (frameIndex === 0) {
				// First frame is always the base frame
				return JSON.parse(JSON.stringify({
					id: stickmanId,
					joints: baseFrames[stickmanId]
				}));
			}
			
			if (!deltaFrames[stickmanId] || frameIndex - 1 >= deltaFrames[stickmanId].length) {
				return null;
			}
			
			// Start with base frame and apply deltas incrementally
			let currentJoints = deepClone(baseFrames[stickmanId]);
			
			for (let i = 0; i < frameIndex; i++) {
				if (deltaFrames[stickmanId][i]) {
					currentJoints = applyDeltas(currentJoints, deltaFrames[stickmanId][i]);
					// Enforce joint distance constraints after each delta application
					enforceJointDistances(currentJoints);
				}
			}
			
			return {
				id: stickmanId,
				joints: currentJoints
			};
		}

		function rebaseDeltas(stickmanId, removedFrameIndex) {
			if (!deltaFrames[stickmanId] || removedFrameIndex <= 0) return;
			
			const getTotalFrameCount = (id) => {
				if (!baseFrames[id]) return 0;
				return 1 + (deltaFrames[id] ? deltaFrames[id].length : 0);
			};
			
			if (removedFrameIndex === 1) {
				// Removing second frame - need to update base frame and recompute all deltas
				const newBaseFrame = reconstructFrameFromDeltas(stickmanId, 1);
				if (newBaseFrame) {
					baseFrames[stickmanId] = newBaseFrame.joints;
					
					// Recompute all deltas relative to new base
					const newDeltas = [];
					for (let i = 2; i < getTotalFrameCount(stickmanId); i++) {
						const frame = reconstructFrameFromDeltas(stickmanId, i);
						if (frame) {
							const delta = calculateDeltas(frame.joints, baseFrames[stickmanId]);
							if (delta) newDeltas.push(delta);
						}
					}
					deltaFrames[stickmanId] = newDeltas;
				}
			} else {
				// Remove delta frame and recompute subsequent deltas
				const originalDeltas = [...deltaFrames[stickmanId]];
				deltaFrames[stickmanId].splice(removedFrameIndex - 1, 1);
				
				// Recompute deltas for frames after the removed one
				for (let i = removedFrameIndex - 1; i < deltaFrames[stickmanId].length; i++) {
					const currentFrame = reconstructFrameFromDeltas(stickmanId, i + 1);
					const previousFrame = reconstructFrameFromDeltas(stickmanId, i);
					
					if (currentFrame && previousFrame) {
						const newDelta = calculateDeltas(currentFrame.joints, previousFrame.joints);
						if (newDelta) {
							deltaFrames[stickmanId][i] = newDelta;
						}
					}
				}
			}
		}

		// INITIALIZATION FUNCTIONS

		function initializeAnimator() {
			const canvasElement = document.getElementById('stickman-canvas');
			if (canvasElement) {
				initCanvas();
				initEvents();
				initControls();
				render();
			} else {
				console.warn('Canvas element not found, retrying...');
				setTimeout(initializeAnimator, 100);
			}
		}

		function setupDatastore() {
			activity.setup();

			env.getEnvironment(function (err, environment) {
				currentenv = environment;

				// Set current language to Sugarizer
				var defaultLanguage = (typeof chrome != 'undefined' && chrome.app && chrome.app.runtime) ? chrome.i18n.getUILanguage() : navigator.language;
				var language = environment.user ? environment.user.language : defaultLanguage;
				l10n.init(language);

				// Load from datastore
				if (!environment.objectId) {
					console.log("New instance");
					createInitialStickman();
					updateTimeline();
					updateRemoveButtonState();
					render();
				} else {
					// load saved data
					activity.getDatastoreObject().loadAsText(function (error, metadata, data) {
						if (error == null && data != null) {
							const savedData = JSON.parse(data);

							baseFrames = savedData.baseFrames || {};
							deltaFrames = savedData.deltaFrames || {};
							currentFrameIndices = savedData.currentFrameIndices || {};
							speed = savedData.speed || 1;
							currentSpeed = savedData.currentSpeed || 1;
							nextStickmanId = savedData.nextStickmanId || 0;

							// Reconstruct stickmen 
							if (Object.keys(baseFrames).length > 0) {
								stickmen = [];
								
								Object.keys(baseFrames).forEach(stickmanIdStr => {
									const stickmanId = parseInt(stickmanIdStr);
									const frameIndex = currentFrameIndices[stickmanId] || 0;
									const stickman = reconstructFrameFromDeltas(stickmanId, frameIndex);
									if (stickman) {
										stickmen.push(stickman);
									}
								});
								
								stickmen.forEach((_, index) => updateMiddleJoint(index));
								
								// Select first stickman by default
								if (stickmen.length > 0) {
									selectedStickmanIndex = 0;
								}
							} else {
								createInitialStickman();
							}

							updateTimeline();
							updateRemoveButtonState(); 
							render();
						} else {
							console.log("No instance found, creating new instance");
							createInitialStickman();
							updateTimeline();
							updateRemoveButtonState(); 
							render();
						}
					});
				}

				if (environment.sharedId) {
					console.log("Shared instance");
					isShared = true;
					presence = activity.getPresenceObject(function(error, network) {
						if (error) {
							console.log("Error joining shared activity");
							return;
						}
						console.log("Joined shared activity");
						network.onDataReceived(onNetworkDataReceived);
						network.onSharedActivityUserChanged(onNetworkUserChanged);
					});
				}
			});
		}

		// translate toolbar buttons (localize the toolbar buttons)
		function translateToolbarButtons() {
			const buttonsToTranslate = [
				{ id: 'network-button', key: 'Network' },
				{ id: 'play-pause-button', key: 'PlayPause' },
				{ id: 'speed-button', key: 'Speed' },
				{ id: 'minus-button', key: 'RemoveStickman' },
				{ id: 'addStickman-button', key: 'AddStickman' },
				{ id: 'template-button', key: 'Templates' },
				{ id: 'import-button', key: 'Import' },
				{ id: 'export-button', key: 'Export' },
				{ id: 'stop-button', key: 'Stop' },
				{ id: 'fullscreen-button', key: 'Fullscreen' },
				{ id: 'help-button', key: 'Tutorial' },
				{ id: 'add-button', key: 'AddFrame' }
			];

			buttonsToTranslate.forEach(button => {
				const element = document.getElementById(button.id);
				if (element) {
					const translatedText = l10n.get(button.key);
					if (translatedText) {
						element.title = translatedText;
					}
				}
			});
		}

		document.getElementById('stop-button').addEventListener('click', function () {
			console.log("writing...");

			const saveData = {
				baseFrames: baseFrames,
				deltaFrames: deltaFrames,
				currentFrameIndices: currentFrameIndices,
				speed: speed,
				currentSpeed: currentSpeed,
				nextStickmanId: nextStickmanId
			};

			var jsonData = JSON.stringify(saveData);
			activity.getDatastoreObject().setDataAsText(jsonData);
			activity.getDatastoreObject().save(function (error) {
				if (error === null) {
					console.log("write done.");
				} else {
					console.log("write failed.");
				}
				activity.close();
			});
		});

		document.getElementById("help-button").addEventListener('click', function (e) {
			tutorial.start();
		});

		function initCanvas() {
			canvas = document.getElementById('stickman-canvas');
			ctx = canvas.getContext('2d');
			resizeCanvas();
			window.addEventListener('resize', resizeCanvas);
		}

		function resizeCanvas() {
			canvas.width = canvas.parentElement.clientWidth - 32;
			// Reduce canvas height by an additional 50 pixels to ensure stickmen never go behind the timeline
			canvas.height = canvas.parentElement.clientHeight - 250;
		}

		function initEvents() {
			canvas.addEventListener('mousedown', handleMouseDown);
			canvas.addEventListener('mousemove', handleMouseMove);
			canvas.addEventListener('mouseup', handleMouseUp);

			// Control buttons
			document.getElementById('add-button').addEventListener('click', addFrame);
			document.getElementById('export-button').addEventListener('click', exportAnimation);
			document.getElementById('addStickman-button').addEventListener('click', addNewStickman);
			document.getElementById('minus-button').addEventListener('click', removeSelectedStickman);

			// Initialize datastore
			setupDatastore();
		}

		function initControls() {
			// Play/Pause button setup
			const playPauseButton = document.getElementById('play-pause-button');
			playPauseButton.style.backgroundImage = "url('icons/play.svg')";
			playPauseButton.style.backgroundPosition = "center";
			playPauseButton.style.backgroundRepeat = "no-repeat";
			playPauseButton.style.backgroundSize = "contain";
			playPauseButton.addEventListener('click', togglePlayPause);

			// Speed control setup
			const speedButton = document.getElementById("speed-button");
			const speedPalette = new speedpalette.SpeedPalette(speedButton);
			speedPalette.addEventListener('speed', function (e) {
				currentSpeed = e.detail.speed;
				speed = currentSpeed;
				console.log("Speed set to:", currentSpeed.toFixed(2) + "x");
			});

			// Template palette
			var templateButton = document.getElementById("template-button");
			var templatePalette = new templatepalette.TemplatePalette(templateButton);

			document.addEventListener('template-selected', function (e) {
				loadTemplate(e.detail.template);
			});

			// Presence palette setup
			var palette = new presencepalette.PresencePalette(
				document.getElementById("network-button"),
				undefined
			);

			palette.addEventListener('shared', function() {
				palette.popDown();
				console.log("Want to share");
				presence = activity.getPresenceObject(function(error, network) {
					if (error) {
						console.log("Sharing error");
						return;
					}
					network.createSharedActivity('org.sugarlabs.Stickman', function(groupId) {
						console.log("Activity shared");
						isHost = true;
					});
					network.onDataReceived(onNetworkDataReceived);
					network.onSharedActivityUserChanged(onNetworkUserChanged);
				});
			});
		}

		// NETWORK CALLBACKS

		var onNetworkDataReceived = function (msg) {
			if (presence.getUserInfo().networkId === msg.user.networkId) {
				return;
			}
			console.log("Network data received:", msg);
			// TODO: Handle different message types
		};

		var onNetworkUserChanged = function (msg) {
			console.log("User " + msg.user.name + " " + (msg.move == 1 ? "join" : "leave"));
			// TODO: Handle user join/leave events
		};

		// STICKMAN CREATION & MANAGEMENT

		function createStickmanJoints(centerX, centerY, id) {
			const scale = 1.0; // Can be adjusted for different sizes
			
			return {
				id: id,
				joints: [
					{ x: centerX, y: centerY - 65 * scale, name: 'head' },                    // 0 - head
					{ x: centerX, y: centerY - 45 * scale, name: 'body' },                    // 1 - body (neck)
					{ x: centerX, y: centerY + 15 * scale, name: 'hips' },                    // 2 - hips
					{ x: centerX - 15 * scale, y: centerY + 55 * scale, name: 'leftKnee' },   // 3 - left knee
					{ x: centerX - 20 * scale, y: centerY + 95 * scale, name: 'leftFoot' },   // 4 - left foot
					{ x: centerX + 15 * scale, y: centerY + 55 * scale, name: 'rightKnee' },  // 5 - right knee
					{ x: centerX + 20 * scale, y: centerY + 95 * scale, name: 'rightFoot' },  // 6 - right foot
					{ x: centerX - 25 * scale, y: centerY - 35 * scale, name: 'leftElbow' },  // 7 - left elbow
					{ x: centerX - 40 * scale, y: centerY - 5 * scale, name: 'leftHand' },    // 8 - left hand
					{ x: centerX + 25 * scale, y: centerY - 35 * scale, name: 'rightElbow' }, // 9 - right elbow
					{ x: centerX + 40 * scale, y: centerY - 5 * scale, name: 'rightHand' },   // 10 - right hand
					{ x: centerX, y: centerY - 15 * scale, name: 'middle' }                   // 11 - middle (torso center)
				]
			};
		}

		function createInitialStickman() {
			const centerX = canvas.width / 2;
			const centerY = canvas.height / 2 - 20;

			const initialStickman = createStickmanJoints(centerX, centerY, nextStickmanId++);
			
			// Ensure the initial stickman has proper joint distances
			enforceJointDistances(initialStickman.joints);
			
			stickmen = [initialStickman];
			
			// Initialize base frame for this stickman
			baseFrames[initialStickman.id] = deepClone(initialStickman.joints);
			deltaFrames[initialStickman.id] = [];
			currentFrameIndices[initialStickman.id] = 0;
			
			neckManuallyMoved = false; // Reset flag for new stickman
			updateMiddleJoint(0);
			// by default first stickman is selected
			selectedStickmanIndex = 0;
			updateRemoveButtonState(); 
		}

		function addNewStickman() {
			// Calculate safe boundaries based on the improved stickman proportions
			const stickmanHeight = 160; // Head to feet distance (65 + 95)
			const stickmanWidth = 80;   // Hand to hand span (40 + 40)
			const margin = 30; 
			
			const minX = stickmanWidth / 2 + margin;
			const maxX = canvas.width - stickmanWidth / 2 - margin;
			const minY = 65 + margin; // Head distance above center
			const maxY = canvas.height - 95 - margin; // Feet distance below center

			// Ensure valid bounds exist
			if (maxX <= minX || maxY <= minY) {
				console.warn("Canvas too small for new stickman");
				return;
			}
			
			// Try to find a position that doesn't overlap with existing stickmen
			let centerX, centerY;
			let attempts = 0;
			const maxAttempts = 20;
			const minDistance = 100; // Minimum distance between stickman centers
			
			do {
				centerX = Math.random() * (maxX - minX) + minX;
				centerY = Math.random() * (maxY - minY) + minY;
				
				// Check if position is too close to existing stickmen
				const isTooClose = stickmen.some(stickman => {
					const existingCenter = stickman.joints[11]; // middle joint
					const distance = Math.sqrt(
						Math.pow(centerX - existingCenter.x, 2) + 
						Math.pow(centerY - existingCenter.y, 2)
					);
					return distance < minDistance;
				});
				
				if (!isTooClose) break;
				attempts++;
			} while (attempts < maxAttempts);

			const newStickman = createStickmanJoints(centerX, centerY, nextStickmanId++);
			
			// Ensure proper joint distances
			enforceJointDistances(newStickman.joints);
			
			stickmen.push(newStickman);
			updateMiddleJoint(stickmen.length - 1);

			// Initialize base and delta frames for this stickman
			baseFrames[newStickman.id] = deepClone(newStickman.joints);
			deltaFrames[newStickman.id] = [];
			currentFrameIndices[newStickman.id] = 0;
			
			selectedStickmanIndex = stickmen.length - 1;
			neckManuallyMoved = false;

			updateTimeline();
			updateRemoveButtonState(); 
			console.log(`Added new stickman. Total: ${stickmen.length}`);
		}

		function confirmationModal(stickmanId, stickmanToRemove) {
			const modalOverlay = document.createElement('div');
			modalOverlay.className = 'modal-overlay';

			const modal = document.createElement('div');
			modal.className = 'modal-content';

			const header = document.createElement('div');
			header.className = 'modal-header';

			const title = document.createElement('h3');
			title.textContent = l10n.get("RemoveStickman");
			title.className = 'modal-title';

			const body = document.createElement('div');
			body.className = 'modal-body';

			const message = document.createElement('p');
			message.textContent = l10n.get("ConfirmRemoval");
			message.className = 'modal-message';

			// button container
			const buttonContainer = document.createElement('div');
			buttonContainer.className = 'modal-button-container';

			// cancel button
			const cancelButton = document.createElement('button');
			cancelButton.className = 'modal-button';
			cancelButton.innerHTML = `
				<span class="modal-button-icon modal-button-icon-cancel"></span>${l10n.get("No")}
			`;

			// confirm button
			const confirmButton = document.createElement('button');
			confirmButton.className = 'modal-button modal-button-confirm';
			confirmButton.innerHTML = `
				<span class="modal-button-icon modal-button-icon-ok"></span>${l10n.get("Yes")}
			`;

			cancelButton.onclick = () => {
				document.body.removeChild(modalOverlay);
			};

			confirmButton.onclick = () => {
				document.body.removeChild(modalOverlay);

				if (stickmen.length > 1) {
					const stickmanId = stickmen[stickmanToRemove].id;
					
					// Remove from current stickmen array
					stickmen.splice(stickmanToRemove, 1);

					// Remove stickman frames
					delete baseFrames[stickmanId];
					delete deltaFrames[stickmanId];
					delete currentFrameIndices[stickmanId];

					// Adjust selected stickman index if needed
					if (selectedStickmanIndex === stickmanToRemove) {
						selectedJoint = null;
						selectedStickmanIndex = stickmen.length > 0 ? 0 : -1;
					} else if (selectedStickmanIndex > stickmanToRemove) {
						selectedStickmanIndex--;
					}

					updateTimeline();
					updateRemoveButtonState();

					// If only one stickman remains, automatically exit removal mode
					if (stickmen.length <= 1) {
						exitRemovalMode();
					}
				} else {
					console.error("Cannot remove the last stickman. At least one stickman must remain.");
				}
			};

			// Close modal when clicking overlay
			modalOverlay.onclick = (e) => {
				if (e.target === modalOverlay) {
					document.body.removeChild(modalOverlay);
				}
			};

			// Assemble modal
			header.appendChild(title);
			body.appendChild(message);
			buttonContainer.appendChild(cancelButton);
			buttonContainer.appendChild(confirmButton);
			body.appendChild(buttonContainer);
			modal.appendChild(header);
			modal.appendChild(body);
			modalOverlay.appendChild(modal);

			// Add to page
			document.body.appendChild(modalOverlay);
		}

		function removeSelectedStickman() {
			// Check if only one stickman remains
			if (stickmen.length <= 1) {
				console.log("Cannot remove the last stickman");
				return;
			}

			if (!isRemovalMode) {
				isRemovalMode = true;
				document.getElementById('minus-button').style.backgroundColor = '#808080';
				canvas.style.cursor = 'crosshair';
			} else {
				exitRemovalMode();
			}
		}

		function updateRemoveButtonState() {
			const minusButton = document.getElementById('minus-button');

			if (stickmen.length <= 1) {
				minusButton.disabled = true;
				minusButton.title = l10n.get("CannotRemoveLastStickman");
			} else {
				minusButton.disabled = false;
				minusButton.title = l10n.get("RemoveStickmanTooltip");
			}
		}

		function exitRemovalMode() {
			isRemovalMode = false;
			document.getElementById('minus-button').style.backgroundColor = '';
			canvas.style.cursor = 'default';
		}

		function updateMiddleJoint(stickmanIndex) {
			if (stickmanIndex >= 0 && stickmanIndex < stickmen.length && !neckManuallyMoved) {
				const joints = stickmen[stickmanIndex].joints;
				joints[11].x = (joints[1].x + joints[2].x) / 2;
				joints[11].y = (joints[1].y + joints[2].y) / 2;
			}
		}

		async function loadTemplate(templateName) {
			try {
				const response = await fetch(`js/templates/${templateName}.json`);
				if (!response.ok) {
					throw new Error(`Failed to load template: ${templateName}`);
				}
				const templateData = await response.json();

				// Create a new stickman with next ID
				const newStickmanId = nextStickmanId++;
				const newStickman = createStickmanJoints(canvas.width / 2, canvas.height / 2, newStickmanId);
				
				// Reset to single stickman
				stickmen = [newStickman];
				selectedStickmanIndex = 0;
				
				// Initialize delta structure for this stickman
				baseFrames = {};
				deltaFrames = {};
				currentFrameIndices = {};
				currentFrameIndices[newStickmanId] = 0;
				
				// Convert template frames to new format
				const templateFrames = JSON.parse(JSON.stringify(templateData.frames));
				if (templateFrames.length > 0) {
					// Process first frame as base frame
					let firstFrame = templateFrames[0];
					
					if (Array.isArray(firstFrame) && firstFrame.length > 0) {
						if (Array.isArray(firstFrame[0])) {
							baseFrames[newStickmanId] = firstFrame[0];
						} else if (firstFrame[0].joints) {
							baseFrames[newStickmanId] = firstFrame[0].joints;
						} else {
							baseFrames[newStickmanId] = firstFrame;
						}
					} else if (firstFrame.joints) {
						baseFrames[newStickmanId] = firstFrame.joints;
					} else {
						baseFrames[newStickmanId] = firstFrame;
					}
					
					// Ensure middle joint exists
					if (baseFrames[newStickmanId].length === 11) {
						baseFrames[newStickmanId].push({
							x: (baseFrames[newStickmanId][1].x + baseFrames[newStickmanId][2].x) / 2,
							y: (baseFrames[newStickmanId][1].y + baseFrames[newStickmanId][2].y) / 2,
							name: 'middle'
						});
					}
					
					// Process subsequent frames as deltas
					deltaFrames[newStickmanId] = [];
					for (let i = 1; i < templateFrames.length; i++) {
						let currentFrame = templateFrames[i];
						let previousFrame = templateFrames[i - 1];
						
						// Normalize frame structure
						let currentJoints, previousJoints;
						
						if (Array.isArray(currentFrame) && currentFrame.length > 0) {
							currentJoints = Array.isArray(currentFrame[0]) ? currentFrame[0] : 
								(currentFrame[0].joints ? currentFrame[0].joints : currentFrame);
						} else if (currentFrame.joints) {
							currentJoints = currentFrame.joints;
						} else {
							currentJoints = currentFrame;
						}
						
						if (Array.isArray(previousFrame) && previousFrame.length > 0) {
							previousJoints = Array.isArray(previousFrame[0]) ? previousFrame[0] : 
								(previousFrame[0].joints ? previousFrame[0].joints : previousFrame);
						} else if (previousFrame.joints) {
							previousJoints = previousFrame.joints;
						} else {
							previousJoints = previousFrame;
						}
						
						// Ensure middle joint exists in both frames
						if (currentJoints.length === 11) {
							currentJoints.push({
								x: (currentJoints[1].x + currentJoints[2].x) / 2,
								y: (currentJoints[1].y + currentJoints[2].y) / 2,
								name: 'middle'
							});
						}
						if (previousJoints.length === 11) {
							previousJoints.push({
								x: (previousJoints[1].x + previousJoints[2].x) / 2,
								y: (previousJoints[1].y + previousJoints[2].y) / 2,
								name: 'middle'
							});
						}
						
						// Calculate delta
						const delta = calculateDeltas(currentJoints, previousJoints);
						if (delta) {
							deltaFrames[newStickmanId].push(delta);
						}
					}
					
					// Update current stickman to base frame
					stickmen[0] = {
						id: newStickmanId,
						joints: JSON.parse(JSON.stringify(baseFrames[newStickmanId]))
					};
				}
				
				neckManuallyMoved = false;
				updateMiddleJoint(0);
				updateTimeline();
			} catch (error) {
				console.error('Error loading template:', error);
				createInitialStickman();
			}
		}

		// FRAME MANAGEMENT

		function addFrame() {
			// If no stickman is selected, add frame for all stickmen Otherwise, add frame only for selected stickman
			const targetStickmanIndices = selectedStickmanIndex >= 0 ? 
				[selectedStickmanIndex] : stickmen.map((_, index) => index);
			
			targetStickmanIndices.forEach(index => {
				updateMiddleJoint(index);
				
				const stickman = stickmen[index];
				const stickmanId = stickman.id;
				
				// Ensure current stickman joints have proper distances before processing
				enforceJointDistances(stickman.joints);
				
				if (!baseFrames[stickmanId]) {
					// First frame - create base frame
					baseFrames[stickmanId] = JSON.parse(JSON.stringify(stickman.joints));
					deltaFrames[stickmanId] = [];
					currentFrameIndices[stickmanId] = 0;
				} else {
					// Additional frame - calculate delta from current position
					const currentFrameIndex = currentFrameIndices[stickmanId];
					const previousFrame = reconstructFrameFromDeltas(stickmanId, currentFrameIndex);
					
					if (previousFrame) {
						const delta = calculateDeltas(stickman.joints, previousFrame.joints);
						if (delta) {
							deltaFrames[stickmanId].push(delta);
							// Update current frame index to the new frame
							const totalFrames = baseFrames[stickmanId] ? 1 + deltaFrames[stickmanId].length : 0;
							currentFrameIndices[stickmanId] = totalFrames - 1;
						}
					}
				}
			});
			
			neckManuallyMoved = false;
			updateTimeline();
		}

		function saveCurrentFrame() {
			// If no stickman is selected or being manipulated, save all stickmen Otherwise, save only the selected stickman
			const targetStickmanIndices = selectedStickmanIndex >= 0 ? 
				[selectedStickmanIndex] : stickmen.map((_, index) => index);
				
			targetStickmanIndices.forEach(index => {
				const stickman = stickmen[index];
				const stickmanId = stickman.id;
				
				// Skip if no frames for this stickman
				if (!baseFrames[stickmanId]) {
					return;
				}
				
				const isNeckOperation = (isRotating || isDragging) && selectedJoint && 
					stickmen[index] === stickman && 
					stickmen[index].joints.indexOf(selectedJoint) === 1;
				
				if (!isNeckOperation) {
					updateMiddleJoint(index);
				}
				
				// Enforce joint distance constraints before saving
				enforceJointDistances(stickman.joints);
				
				const currentFrameIndex = currentFrameIndices[stickmanId];
				const totalFrames = baseFrames[stickmanId] ? 1 + deltaFrames[stickmanId].length : 0;
				
				if (currentFrameIndex === 0) {
					// Update base frame
					baseFrames[stickmanId] = JSON.parse(JSON.stringify(stickman.joints));
					
					// Recompute ALL deltas since base frame changed
					const newDeltas = [];
					for (let i = 1; i < totalFrames; i++) {
						const frame = reconstructFrameFromDeltas(stickmanId, i);
						const prevFrame = reconstructFrameFromDeltas(stickmanId, i - 1);
						
						if (frame && prevFrame) {
							const delta = calculateDeltas(frame.joints, prevFrame.joints);
							if (delta) {
								newDeltas.push(delta);
							}
						}
					}
					deltaFrames[stickmanId] = newDeltas;
					
				} else if (currentFrameIndex > 0) {
					// Update a delta frame - need to recompute this and all subsequent deltas
					const deltaIndex = currentFrameIndex - 1;
					
					if (deltaIndex >= 0 && deltaIndex < deltaFrames[stickmanId].length) {
						// First, temporarily store the current stickman position
						const currentJoints = JSON.parse(JSON.stringify(stickman.joints));
						
						// Get the previous frame
						const previousFrame = reconstructFrameFromDeltas(stickmanId, currentFrameIndex - 1);
						
						if (previousFrame) {
							// Calculate new delta for current frame
							const newDelta = calculateDeltas(currentJoints, previousFrame.joints);
							if (newDelta) {
								deltaFrames[stickmanId][deltaIndex] = newDelta;
							}
							
							// Now recompute all subsequent deltas
							for (let i = currentFrameIndex + 1; i < totalFrames; i++) {
								const nextFrameOld = reconstructFrameFromDeltas(stickmanId, i);
								const prevFrameNew = reconstructFrameFromDeltas(stickmanId, i - 1);
								
								if (nextFrameOld && prevFrameNew) {
									const subsequentDelta = calculateDeltas(nextFrameOld.joints, prevFrameNew.joints);
									if (subsequentDelta) {
										deltaFrames[stickmanId][i - 1] = subsequentDelta;
									}
								}
							}
						}
					}
				}
			});
		}

		// TIMELINE FUNCTIONS

		function updateTimeline() {
			const timeline = document.getElementById('timeline');
			timeline.innerHTML = '';
			
			// If no stickmen exist, don't show timeline
			if (stickmen.length === 0) {
				return;
			}
			
			// Get the currently selected stickman (or first one if none selected)
			const stickmanIndex = selectedStickmanIndex >= 0 ? selectedStickmanIndex : 0;
			const selectedStickman = stickmen[stickmanIndex];
			const stickmanId = selectedStickman.id;
			const totalFrames = baseFrames[stickmanId] ? 1 + deltaFrames[stickmanId].length : 0;
			const currentFrameIndex = currentFrameIndices[stickmanId] || 0;
			
			// For each frame of the selected stickman, create a preview
			for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
				const frameContainer = document.createElement('div');
				frameContainer.className = 'frame-container';

				const frameData = reconstructFrameFromDeltas(stickmanId, frameIndex);
				const previewCanvas = createPreviewCanvas(frameData, frameIndex, stickmanId);
				const deleteBtn = createDeleteButton(frameIndex, stickmanId);

				previewCanvas.addEventListener('click', () => {
					currentFrameIndices[stickmanId] = frameIndex;

					const newFrameData = reconstructFrameFromDeltas(stickmanId, frameIndex);
					if (newFrameData) {
						stickmen[stickmanIndex] = newFrameData;
						
						neckManuallyMoved = false; // Reset flag when switching frames
						updateMiddleJoint(stickmanIndex);
						updateTimeline();
						render();
					}
				});

				frameContainer.appendChild(previewCanvas);
				frameContainer.appendChild(deleteBtn);
				timeline.appendChild(frameContainer);
			}

			// Scroll to active frame inline
			const activeFrame = timeline.querySelector('.frame.active');
			if (activeFrame) {
				const timelineRect = timeline.getBoundingClientRect();
				const activeFrameRect = activeFrame.getBoundingClientRect();

				if (activeFrameRect.right > timelineRect.right || activeFrameRect.left < timelineRect.left) {
					activeFrame.scrollIntoView({
						behavior: 'smooth',
						block: 'nearest',
						inline: 'center'
					});
				}
			}
		}

		function createPreviewCanvas(frameData, index, stickmanId) {
			const previewCanvas = document.createElement('canvas');
			previewCanvas.width = 80;
			previewCanvas.height = 80;

			const isActive = index === currentFrameIndices[stickmanId];
			previewCanvas.className = `frame ${isActive ? 'active' : ''}`;

			const previewCtx = previewCanvas.getContext('2d');
			previewCtx.fillStyle = isActive ? '#e6f3ff' : '#ffffff';
			previewCtx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);

			// Draw the stickman frame data
			if (frameData && frameData.joints) {
				const joints = frameData.joints;

				// Calculate bounds for this single stickman
				const stickmanHeight = Math.max(...joints.map(p => p.y)) - Math.min(...joints.map(p => p.y));
				const stickmanWidth = Math.max(...joints.map(p => p.x)) - Math.min(...joints.map(p => p.x));
				const scale = Math.min(40 / stickmanHeight, 40 / stickmanWidth);

				const centerX = (Math.max(...joints.map(p => p.x)) + Math.min(...joints.map(p => p.x))) / 2;
				const centerY = (Math.max(...joints.map(p => p.y)) + Math.min(...joints.map(p => p.y))) / 2;

				previewCtx.save();
				previewCtx.translate(previewCanvas.width / 2, previewCanvas.height / 2);
				previewCtx.scale(scale, scale);
				previewCtx.translate(-centerX, -centerY);

				// Draw stickman in preview
				drawStickmanPreview(previewCtx, joints);

				previewCtx.restore();
			}

			return previewCanvas;
		}

		function createDeleteButton(frameIndex, stickmanId) {
			const deleteBtn = document.createElement('button');
			deleteBtn.className = 'delete-frame';
			deleteBtn.innerHTML = '';
			deleteBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				const totalFrames = baseFrames[stickmanId] ? 1 + deltaFrames[stickmanId].length : 0;
				
				if (totalFrames > 1) {
					// Remove this frame using delta system
					if (frameIndex === 0) {
						// Removing base frame - promote second frame to base
						const secondFrame = reconstructFrameFromDeltas(stickmanId, 1);

						if (secondFrame) {
							baseFrames[stickmanId] = secondFrame.joints;

							// Remove first delta and recompute remaining deltas
							deltaFrames[stickmanId].shift();
							
							// Recompute all remaining deltas relative to new base
							const newDeltas = [];

							for (let i = 1; i < deltaFrames[stickmanId].length + 1; i++) {
								const currentFrame = reconstructFrameFromDeltas(stickmanId, i);
								const previousFrame = reconstructFrameFromDeltas(stickmanId, i - 1);

								if (currentFrame && previousFrame) {
									const delta = calculateDeltas(currentFrame.joints, previousFrame.joints);
									if (delta) newDeltas.push(delta);
								}
							}

							deltaFrames[stickmanId] = newDeltas;
						}
					} else {
						// Remove delta frame and rebase subsequent deltas
						rebaseDeltas(stickmanId, frameIndex);
					}
					
					// Adjust current frame index if needed
					const newTotalFrames = baseFrames[stickmanId] ? 1 + deltaFrames[stickmanId].length : 0;
					currentFrameIndices[stickmanId] = Math.min(
						currentFrameIndices[stickmanId], 
						newTotalFrames - 1
					);
					
					// Find the stickman with this ID in the current stickmen array
					for (let i = 0; i < stickmen.length; i++) {
						if (stickmen[i].id === stickmanId) {
							const newFrameIndex = currentFrameIndices[stickmanId];
							const newFrameData = reconstructFrameFromDeltas(stickmanId, newFrameIndex);

							if (newFrameData) {
								stickmen[i] = newFrameData;
								neckManuallyMoved = false;
								updateMiddleJoint(i);
							}

							break;
						}
					}
					updateTimeline();
				}
			});
			return deleteBtn;
		}

		// DRAWING FUNCTIONS

		function drawStickmanPreview(ctx, joints) {
			ctx.strokeStyle = '#000000';
			ctx.lineWidth = 2;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';

			drawStickmanSkeleton(ctx, joints);

			ctx.fillStyle = '#ff0000';
			joints.forEach((joint, index) => {
				if (index === 11) 
					return; 
				ctx.beginPath();
				if (index === 0) {
					ctx.arc(joint.x, joint.y, 3, 0, Math.PI * 2);
				} else {
					ctx.arc(joint.x, joint.y, 2, 0, Math.PI * 2);
				}
				ctx.fill();
			});
		}

		function drawAllStickmen() {
			stickmen.forEach((stickman, stickmanIndex) => {
				drawStickman(stickman.joints, stickmanIndex);
			});
		}

		function drawStickman(joints, stickmanIndex) {
			// skeleton first
			ctx.strokeStyle = '#000000';
			ctx.lineWidth = 3;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';
			drawStickmanSkeleton(ctx, joints);

			// Show joints for selected stickman, or first stickman if none selected
			const shouldShowJoints = (selectedStickmanIndex >= 0)
				? stickmanIndex === selectedStickmanIndex
				: stickmanIndex === 0;

			// Only draw joints for the active stickman
			if (shouldShowJoints) {
				joints.forEach((joint, index) => {
					if (index === 11) 
						return; // Skip middle joint in regular drawing

					// Different colors for different joint types
					if (index === 2) { 
						// Hip joint - drag anchor
						ctx.fillStyle = '#00ff00';
						ctx.strokeStyle = '#00cc00';
					} else if (isRotationalJoint(index)) { 
						// Rotational joints
						ctx.fillStyle = '#ff8800';
						ctx.strokeStyle = '#cc6600';
					} else { 
						// Regular joints
						ctx.fillStyle = '#ff0000';
						ctx.strokeStyle = '#cc0000';
					}

					ctx.lineWidth = 1.5;
					ctx.beginPath();
					ctx.arc(joint.x, joint.y, 4, 0, Math.PI * 2);
					ctx.fill();
					ctx.stroke();
				});
			}

			// Draw middle joint only for selected stickman 
			if (shouldShowJoints) {
				const middleJoint = joints[11];
				ctx.fillStyle = '#ff8800';
				ctx.strokeStyle = '#cc6600';
				ctx.lineWidth = 1.5;
				ctx.beginPath();
				ctx.arc(middleJoint.x, middleJoint.y, 4, 0, Math.PI * 2);
				ctx.fill();
				ctx.stroke();
			}
		}

		function drawStickmanSkeleton(ctx, joints) {
			ctx.strokeStyle = '#000000';
			ctx.lineWidth = 12;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';

			// body line
			ctx.beginPath();
			ctx.moveTo(joints[0].x, joints[0].y);
			ctx.lineTo(joints[1].x, joints[1].y);
			if (joints[11]) {
				ctx.lineTo(joints[11].x, joints[11].y);
			}
			ctx.lineTo(joints[2].x, joints[2].y);
			ctx.stroke();

			// left leg
			ctx.beginPath();
			ctx.moveTo(joints[2].x, joints[2].y); // hips
			ctx.lineTo(joints[3].x, joints[3].y); // left knee
			ctx.lineTo(joints[4].x, joints[4].y); // left foot
			ctx.stroke();

			// right leg
			ctx.beginPath();
			ctx.moveTo(joints[2].x, joints[2].y); // hips
			ctx.lineTo(joints[5].x, joints[5].y); // right knee
			ctx.lineTo(joints[6].x, joints[6].y); // right foot
			ctx.stroke();

			// left arm
			ctx.beginPath();
			ctx.moveTo(joints[1].x, joints[1].y); // body
			ctx.lineTo(joints[7].x, joints[7].y); // left elbow
			ctx.lineTo(joints[8].x, joints[8].y); // left hand
			ctx.stroke();

			// right arm
			ctx.beginPath();
			ctx.moveTo(joints[1].x, joints[1].y);    // body
			ctx.lineTo(joints[9].x, joints[9].y);    // right elbow
			ctx.lineTo(joints[10].x, joints[10].y);  // right hand
			ctx.stroke();

			// head circle (solid black)
			ctx.beginPath();
			ctx.arc(joints[0].x, joints[0].y, 17, 0, Math.PI * 2);
			ctx.fillStyle = '#000000';
			ctx.fill();
		}

		// HIERARCHICAL ROTATION SYSTEM

		function rotatePointAroundPivot(point, pivot, angle) {
			const cos = Math.cos(angle);
			const sin = Math.sin(angle);
			const dx = point.x - pivot.x;
			const dy = point.y - pivot.y;
			
			return {
				x: pivot.x + (dx * cos - dy * sin),
				y: pivot.y + (dx * sin + dy * cos)
			};
		}

		function rotateJointHierarchy(stickmanIndex, pivotJointIndex, angle) {
			const joints = stickmen[stickmanIndex].joints;
			let pivot;
			let pivotJointIndex_actual; // The joint that acts as the actual rotation pivot
			
			// Determine the actual pivot point for rotation
			if (pivotJointIndex === 11) { 
				// middle joint rotates around hip
				pivot = joints[2];
				pivotJointIndex_actual = 2;
			} else if (pivotJointIndex === 1) { 
				// body/neck rotates around middle joint
				pivot = joints[11];
				pivotJointIndex_actual = 11;
			} else if (pivotJointIndex === 7 || pivotJointIndex === 9) { 
				// elbows rotate around body
				pivot = joints[1];
				pivotJointIndex_actual = 1;
			} else if (pivotJointIndex === 3 || pivotJointIndex === 5) { 
				// knees rotate around hip
				pivot = joints[2];
				pivotJointIndex_actual = 2;
			} else {
				pivot = joints[pivotJointIndex];
				pivotJointIndex_actual = pivotJointIndex;
			}

			// Store pivot position to prevent it from changing during rotation
			const fixedPivot = { 
				x: pivot.x, 
				y: pivot.y 
			};

			// Rotate all child joints recursively
			function rotateChildren(parentIndex, rotationAngle) {
				const childIndices = jointHierarchy[parentIndex] || [];
				
				childIndices.forEach(childIndex => {
					// Never rotate the pivot joint itself
					if (childIndex === pivotJointIndex_actual) return;
					
					const oldPos = { 
						x: joints[childIndex].x, 
						y: joints[childIndex].y 
					};
					const newPos = rotatePointAroundPivot(oldPos, fixedPivot, rotationAngle);
					joints[childIndex].x = newPos.x;
					joints[childIndex].y = newPos.y;
					
					// Recursively rotate children of this joint
					rotateChildren(childIndex, rotationAngle);
				});
			}

			// First rotate the selected joint itself around its pivot (except pivot joints)
			if (pivotJointIndex !== pivotJointIndex_actual) {
				const oldPos = { 
					x: joints[pivotJointIndex].x, 
					y: joints[pivotJointIndex].y 
				};
				const newPos = rotatePointAroundPivot(oldPos, fixedPivot, angle);
				joints[pivotJointIndex].x = newPos.x;
				joints[pivotJointIndex].y = newPos.y;
			}

			// Then rotate all children
			rotateChildren(pivotJointIndex, angle);

			// Ensure pivot joint position is preserved (especially important for middle joint)
			if (pivotJointIndex_actual < joints.length) {
				joints[pivotJointIndex_actual].x = fixedPivot.x;
				joints[pivotJointIndex_actual].y = fixedPivot.y;
			}
		}

		function getAngle(point1, point2) {
			return Math.atan2(point2.y - point1.y, point2.x - point1.x);
		}

		function isRotationalJoint(jointIndex) {
			// These joints support rotation with hierarchical movement
			return [1, 2, 3, 5, 7, 9, 11].includes(jointIndex);
		}

		function getRotationPivot(stickmanIndex, jointIndex) {
			const joints = stickmen[stickmanIndex].joints;
			
			// Define pivot mapping for rotational joints
			const pivotMap = {
				11: joints[2],  // middle joint rotates around hip
				1: { x: joints[11].x, y: joints[11].y },  // body/neck rotates around middle joint
				7: joints[1],   // left elbow rotates around body
				9: joints[1],   // right elbow rotates around body
				3: joints[2],   // left knee rotates around hip
				5: joints[2]    // right knee rotates around hip
			};
			
			return pivotMap[jointIndex] || joints[jointIndex]; // fallback to joint itself
		}

		// ANIMATION CONTROL

		function togglePlayPause() {
			if (isPlaying) {
				pause();
			} else {
				play();
			}
		}

		function play() {
			if (!isPlaying) {
				isPlaying = true;
				document.getElementById('play-pause-button').style.backgroundImage = "url('icons/pause.svg')";
				animate();
			}
		}

		function pause() {
			isPlaying = false;
			document.getElementById('play-pause-button').style.backgroundImage = "url('icons/play.svg')";
		}

		function animate() {
			if (!isPlaying) 
				return;

			stickmen.forEach((stickman, index) => {
				const stickmanId = stickman.id;
				const totalFrames = baseFrames[stickmanId] ? 1 + deltaFrames[stickmanId].length : 0;
				
				if (totalFrames > 1) {
					// Only animate if there are multiple frames
					// Move to next frame for this stickman
					currentFrameIndices[stickmanId] = (currentFrameIndices[stickmanId] + 1) % totalFrames;
					const newFrameIndex = currentFrameIndices[stickmanId];

					const newFrameData = reconstructFrameFromDeltas(stickmanId, newFrameIndex);
					if (newFrameData) {
						stickmen[index] = newFrameData;
						updateMiddleJoint(index);
					}
				}
			});
			
			neckManuallyMoved = false; 
			updateTimeline();

			setTimeout(() => {
				requestAnimationFrame(animate);
			}, 1000 / (currentSpeed * 2));
		}

		// MOUSE INTERACTION

		function handleMouseDown(e) {
			const { mouseX, mouseY } = getCanvasCoordinates(e);
			const result = findJointAtPosition(mouseX, mouseY);

			if (isRemovalMode && result) {
				// Remove the clicked stickman
				const stickmanToRemove = result.stickmanIndex;
				const stickmanId = stickmen[stickmanToRemove].id;

				confirmationModal(stickmanId, stickmanToRemove);
				return;
			}

			if (isRemovalMode) {
				// Stay in removal mode when clicking on canvas - don't exit
				return;
			}

			// Normal selection 
			if (result) {
				const previousSelectedIndex = selectedStickmanIndex;
				selectedJoint = result.joint;
				selectedStickmanIndex = result.stickmanIndex;

				// Update timeline if selected stickman changed
				if (previousSelectedIndex !== selectedStickmanIndex) {
					updateTimeline();
				}

				const selectedJointIndex = stickmen[selectedStickmanIndex].joints.indexOf(selectedJoint);

				originalJoints = deepClone(stickmen[selectedStickmanIndex].joints);

				// create frame if none exists at current position for this stickman
				const stickman = stickmen[selectedStickmanIndex];
				const stickmanId = stickman.id;
				if (!baseFrames[stickmanId]) {
					updateMiddleJoint(selectedStickmanIndex);
					enforceJointDistances(stickman.joints);
					baseFrames[stickmanId] = deepClone(stickman.joints);
					deltaFrames[stickmanId] = [];
					currentFrameIndices[stickmanId] = 0;
					updateTimeline();
				}

				if (selectedJointIndex === 2) { 
					// Hip joint - drag whole stickman
					isDraggingWhole = true;
					dragStartPos = { 
						x: mouseX, 
						y: mouseY 
					};
				} else if (isRotationalJoint(selectedJointIndex)) {
					// Start rotation for hierarchical joints
					isRotating = true;
					rotationPivot = getRotationPivot(selectedStickmanIndex, selectedJointIndex);
					rotationStartAngle = getAngle(
						rotationPivot, { 
							x: mouseX, 
							y: mouseY 
						}
					);
				} else {
					// Regular joint dragging for non-hierarchical joints (head, hands, feet)
					isDragging = true;
				}
			} else {
				const previousSelectedIndex = selectedStickmanIndex;
				selectedJoint = null;
				selectedStickmanIndex = -1;
				originalJoints = [];

				// Update timeline if selection was cleared
				if (previousSelectedIndex !== -1) {
					updateTimeline();
				}
			}
		}

		function handleMouseMove(e) {
			const { mouseX, mouseY } = getCanvasCoordinates(e);

			if (isDraggingWhole && selectedStickmanIndex >= 0) {
				// Drag entire stickman using hip as anchor
				const deltaX = mouseX - dragStartPos.x;
				const deltaY = mouseY - dragStartPos.y;

				stickmen[selectedStickmanIndex].joints.forEach((joint, index) => {
					joint.x = originalJoints[index].x + deltaX;
					joint.y = originalJoints[index].y + deltaY;
				});

				// No need to enforce constraints when moving the whole stickman
				saveCurrentFrame();
				updateTimeline();
			} else if (isRotating && selectedJoint && selectedStickmanIndex >= 0 && rotationPivot) {
				// Hierarchical rotation
				const currentAngle = getAngle(rotationPivot, { x: mouseX, y: mouseY });
				const angleDiff = currentAngle - rotationStartAngle;
				
				const selectedJointIndex = stickmen[selectedStickmanIndex].joints.indexOf(selectedJoint);
				
				// Reset to original positions before applying rotation
				stickmen[selectedStickmanIndex].joints.forEach((joint, index) => {
					joint.x = originalJoints[index].x;
					joint.y = originalJoints[index].y;
				});
				
				// Apply rotation
				rotateJointHierarchy(selectedStickmanIndex, selectedJointIndex, angleDiff);
				
				// Enforce joint distance constraints after rotation
				enforceJointDistances(stickmen[selectedStickmanIndex].joints);
				
				// Mark neck as manually moved if we're rotating the neck joint
				if (selectedJointIndex === 1) {
					neckManuallyMoved = true;
				}
				
				// Only update middle joint position if we're not rotating the neck (body joint)
				// When rotating the neck around the middle joint, the middle joint should stay fixed
				if (selectedJointIndex !== 1) {
					updateMiddleJoint(selectedStickmanIndex);
				}

				saveCurrentFrame();
				updateTimeline();
			} else if (isDragging && selectedJoint && selectedStickmanIndex >= 0) {
				const selectedJointIndex = stickmen[selectedStickmanIndex].joints.indexOf(selectedJoint);

				selectedJoint.x = mouseX;
				selectedJoint.y = mouseY;

				// Mark neck as manually moved if we're dragging the neck joint
				if (selectedJointIndex === 1) {
					neckManuallyMoved = true;
				}

				enforceJointDistances(stickmen[selectedStickmanIndex].joints);

				// Update middle joint position only when hips moved (not when body/neck moved)
				if (selectedJointIndex === 2) {
					updateMiddleJoint(selectedStickmanIndex);
				}

				saveCurrentFrame();
				updateTimeline();
			}
		}

		function handleMouseUp() {
			isDragging = false;
			isDraggingWhole = false;
			isRotating = false;
			rotationPivot = null;
			
			if (selectedStickmanIndex >= 0 && originalJoints.length > 0) {
				// Always save the current frame - the saveCurrentFrame function handles delta recomputation
				saveCurrentFrame();
				updateTimeline();
			}
			
			originalJoints = [];
		}

		function getCanvasCoordinates(e) {
			const rect = canvas.getBoundingClientRect();
			const scaleX = canvas.width / rect.width;
			const scaleY = canvas.height / rect.height;
			return {
				mouseX: (e.clientX - rect.left) * scaleX,
				mouseY: (e.clientY - rect.top) * scaleY
			};
		}

		function findJointAtPosition(x, y) {
			// Check all stickmen, starting from the last one (top layer)
			for (let stickmanIndex = stickmen.length - 1; stickmanIndex >= 0; stickmanIndex--) {
				const joints = stickmen[stickmanIndex].joints;

				// Define hit radii for different joint types
				const getHitRadius = (jointIndex) => {
					switch (jointIndex) {
						case 0: 
							return 15; // head - largest hit area
						case 2: 
							return 12; // hips - large for whole stickman drag
						case 11: 
							return 10; // middle - medium for rotation
						case 1: 
							return 10; // body/neck - medium for rotation
						default: 
							return 8;  // hands, feet, elbows, knees
					}
				};

				// Check joints in order of interaction priority
				const priorityOrder = [2, 11, 1, 0, 7, 9, 3, 5, 8, 10, 4, 6];
				
				for (const jointIndex of priorityOrder) {
					if (jointIndex >= joints.length) continue;
					
					const joint = joints[jointIndex];
					const dx = joint.x - x;
					const dy = joint.y - y;
					const distance = Math.sqrt(dx * dx + dy * dy);
					const hitRadius = getHitRadius(jointIndex);

					if (distance < hitRadius) {
						return { 
							joint: joint, 
							stickmanIndex: stickmanIndex 
						};
					}
				}
			}
			return null;
		}

		// RENDERING LOOP

		function render() {
			ctx.clearRect(0, 0, canvas.width, canvas.height);

			// Draw onion skin of previous frame - only for selected stickman
			// do not show during playback
			if (!isPlaying && selectedStickmanIndex >= 0) {
				const stickmanId = stickmen[selectedStickmanIndex].id;
				const totalFrames = baseFrames[stickmanId] ? 1 + deltaFrames[stickmanId].length : 0;
				const currentFrameIndex = currentFrameIndices[stickmanId] || 0;
				
				// Only show onion skin if there's a previous frame
				if (totalFrames > 1 && currentFrameIndex > 0) {
					const prevFrameIndex = currentFrameIndex - 1;
					const prevFrame = reconstructFrameFromDeltas(stickmanId, prevFrameIndex);
					
					if (prevFrame) {
						ctx.save();
						ctx.globalAlpha = 0.3;
						ctx.strokeStyle = '#0066cc';
						ctx.lineWidth = 2;
						ctx.lineCap = 'round';
						ctx.lineJoin = 'round';

						drawStickmanSkeleton(ctx, prevFrame.joints);

						ctx.fillStyle = '#0066cc';
						prevFrame.joints.forEach((joint, index) => {
							// Skip middle joint
							if (index === 11) 
								return;

							ctx.beginPath();
							if (index === 0) {
								ctx.arc(joint.x, joint.y, 4, 0, Math.PI * 2);
							} else {
								ctx.arc(joint.x, joint.y, 2, 0, Math.PI * 2);
							}
							ctx.fill();
						});

						ctx.restore();
					}
				}
			}

			drawAllStickmen();
			requestAnimationFrame(render);
		}

		// EXPORT FUNCTIONALITY

		function exportAnimation() {
			const recordCanvas = document.createElement('canvas');
			recordCanvas.width = canvas.width;
			recordCanvas.height = canvas.height;
			const recordCtx = recordCanvas.getContext('2d');

			const stream = recordCanvas.captureStream(15);
			const mediaRecorder = new MediaRecorder(stream, {
				mimeType: 'video/webm;codecs=vp9'
			});

			const chunks = [];
			mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
			mediaRecorder.onstop = () => {
				const blob = new Blob(chunks, { type: 'video/webm' });
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = 'stickman-animation.webm';
				a.click();
				URL.revokeObjectURL(url);
			};

			mediaRecorder.start();

			// Find the maximum number of frames across all stickmen
			let maxFrames = 0;
			Object.keys(baseFrames).forEach(stickmanId => {
				const totalFrames = baseFrames[stickmanId] ? 1 + deltaFrames[stickmanId].length : 0;
				maxFrames = Math.max(maxFrames, totalFrames);
			});
			
			// Create a copy of current stickmen for animation
			let animationStickmen = JSON.parse(JSON.stringify(stickmen));
			let exportFrameIndices = {};
			
			// Initialize frame indices for export
			stickmen.forEach(stickman => {
				exportFrameIndices[stickman.id] = 0;
			});
			
			let currentExportFrame = 0;
			const renderFrame = () => {
				if (currentExportFrame >= maxFrames) {
					mediaRecorder.stop();
					return;
				}

				recordCtx.fillStyle = '#ffffff';
				recordCtx.fillRect(0, 0, recordCanvas.width, recordCanvas.height);

				// Update each stickman to its current frame for this export frame
				animationStickmen.forEach((stickman, index) => {
					const stickmanId = stickman.id;
					const totalFrames = baseFrames[stickmanId] ? 1 + deltaFrames[stickmanId].length : 0;
					
					if (totalFrames > 0) {
						// Only advance frame if this stickman has more frames
						if (exportFrameIndices[stickmanId] < totalFrames) {
							const frameIndex = exportFrameIndices[stickmanId];
							const frameData = reconstructFrameFromDeltas(stickmanId, frameIndex);
							
							if (frameData) {
								animationStickmen[index] = frameData;
								
								// Move to next frame for next export frame
								exportFrameIndices[stickmanId] = (exportFrameIndices[stickmanId] + 1) % totalFrames;
							}
						}
						
						// Draw the stickman in its current state
						recordCtx.strokeStyle = '#000';
						recordCtx.lineWidth = 8;
						drawStickmanSkeleton(recordCtx, animationStickmen[index].joints);
					}
				});

				currentExportFrame++;
				setTimeout(() => requestAnimationFrame(renderFrame), 150);
			};

			renderFrame();
		}

		// START APPLICATION
		
		// Process localize event
		window.addEventListener("localized", function() {
			console.log("Localization initialized");
			translateToolbarButtons();
		});
		
		activity.setup();
		initializeAnimator();
	});
});