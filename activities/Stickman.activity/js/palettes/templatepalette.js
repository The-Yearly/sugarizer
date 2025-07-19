define([
	"sugar-web/graphics/palette",
	"text!activity/palettes/templatepalette.html"
], function (palette, template) {
	var templatepalette = {};

	templatepalette.TemplatePalette = function (invoker, primaryText) {
		palette.Palette.call(this, invoker, primaryText);
		this.getPalette().id = "template-palette";
		var containerElem = document.createElement("div");
		containerElem.innerHTML = template;
		this.setContent([containerElem]);

		// event listeners for template buttons
		var self = this;
		setTimeout(function () {
			var walkButton = self.getPalette().querySelector("#walk-button");
			var runButton = self.getPalette().querySelector("#run-button");
			var danceButton = self.getPalette().querySelector("#dance-button");
			var jumpButton = self.getPalette().querySelector("#jump-button");

			function setActiveButton(activeButton) {
				[walkButton, runButton, danceButton, jumpButton].forEach(button => {
					if (button) button.classList.remove('active');
				});
				if (activeButton) activeButton.classList.add('active');
			}

			if (walkButton) {
				walkButton.addEventListener("click", function () {
					document.dispatchEvent(new CustomEvent('template-selected', {
						detail: { template: 'walk' }
					}));
					setActiveButton(walkButton);
					self.popDown();
				});
			}

			if (runButton) {
				runButton.addEventListener("click", function () {
					document.dispatchEvent(new CustomEvent('template-selected', {
						detail: { template: 'run' }
					}));
					setActiveButton(runButton);
					self.popDown();
				});
			}

			if (danceButton) {
				danceButton.addEventListener("click", function () {
					document.dispatchEvent(new CustomEvent('template-selected', {
						detail: { template: 'dance' }
					}));
					setActiveButton(danceButton);
					self.popDown();
				});
			}

			if (jumpButton) {
				jumpButton.addEventListener("click", function () {
					document.dispatchEvent(new CustomEvent('template-selected', {
						detail: { template: 'jump' }
					}));
					setActiveButton(jumpButton);
					self.popDown();
				});
			}
		}, 100);
	};

	var addEventListener = function (type, listener, useCapture) {
		return this.getPalette().addEventListener(type, listener, useCapture);
	};

	templatepalette.TemplatePalette.prototype = Object.create(
		palette.Palette.prototype,
		{
			addEventListener: {
				value: addEventListener,
				enumerable: true,
				configurable: true,
				writable: true,
			},
		}
	);

	return templatepalette;
});