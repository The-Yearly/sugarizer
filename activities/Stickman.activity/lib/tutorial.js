define([
], function (
) {
	var tutorial = {};

	tutorial.start = function () {
		var steps = [
			{
				title: "Stickman Activity",
				intro: "Learn how to create animated stickman figures and bring them to life!"
			},
			{
				element: "#network-button",
				position: "bottom",
				title: "Network",
				intro: "Connect with other users to share your animations.",
			},
			{
				element: "#play-pause-button",
				position: "bottom",
				title: "Play/Pause Animation",
				intro: "Click here to play or pause your stickman animation.",
			},
			{
				element: "#speed-button",
				position: "bottom",
				title: "Animation Speed",
				intro: "Click here to adjust the speed of your stickman animation.",
			},
			{
				element: "#minus-button",
				position: "bottom",
				title: "Animation Speed",
				intro: "Click here to adjust the speed of your stickman animation.",
			},
			{
				element: "#addStickman-button",
				position: "bottom",
				title: "Add Stickman",
				intro: "Click here to add a new stickman to your animation.",
			},
			{
				element: "#template-button",
				position: "bottom",
				title: "Templates",
				intro: "Click here to choose a template for your stickman.",
			},
			{
				element: "#import-button",
				position: "bottom",
				title: "Import",
				intro: "Click here to import a stickman template.",
			},
			{
				element: "#export-button",
				position: "bottom",
				title: "Export",
				intro: "Click here to export your stickman animation.",
			},
			{
				element: "#timeline",
				position: "top",
				title: "Timeline",
				intro: "View and navigate through your animation frames here. Click on any frame to edit it.",
			},
			{
				element: "#add-button",
				position: "top",
				title: "Add Frame",
				intro: "Click here to add a new frame to your animation sequence.",
			},
			{
				element: "#fullscreen-button",
				position: "bottom",
				title: "Full Screen",
				intro: "Switch to full screen mode for a better experience.",
			},
		];

		steps = steps.filter(function (obj) {
			return !('element' in obj) || ((obj.element).length && document.querySelector(obj.element) && document.querySelector(obj.element).style.display != 'none');
		});

		introJs().setOptions({
			tooltipClass: 'customTooltip',
			steps: steps,
			prevLabel: "Previous",
			nextLabel: "Next",
			exitOnOverlayClick: false,
			nextToDone: false,
			showBullets: false
		}).start();

	};

	return tutorial;
});