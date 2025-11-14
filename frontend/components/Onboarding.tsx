import React, { useState } from 'react';

interface OnboardingProps {
  onComplete: () => void;
}

const steps = [
  {
    title: 'Welcome to EmoTutor!',
    content: 'Your personal AI coach for emotional intelligence. EmoTutor helps you understand and improve your non-verbal cues during video calls.',
  },
  {
    title: 'How It Works',
    content: 'Using your camera, EmoTutor detects faces and analyzes expressions in real-time. You\'ll receive feedback to help you become more aware of your emotional expressions.',
  },
  {
    title: 'Privacy First',
    content: 'Your privacy is paramount. Only small, cropped images of faces are sent for analysis. We NEVER store or record full video frames, and all data is processed anonymously.',
  },
  {
    title: 'Getting Started',
    content: 'Use the "Capture" toggle to start or stop the analysis at any time. The panel is draggable, so you can place it wherever you like on your screen. Ready to begin?',
  },
];

export const Onboarding: React.FC<OnboardingProps> = ({ onComplete }) => {
  const [step, setStep] = useState(0);

  const handleNext = () => {
    if (step < steps.length - 1) {
      setStep(step + 1);
    } else {
      onComplete();
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 z-[999999] flex items-center justify-center font-sans">
      <div className="bg-gray-800 text-white rounded-lg shadow-2xl w-96 p-8 space-y-6">
        <h1 className="text-2xl font-bold text-center">{steps[step].title}</h1>
        <p className="text-gray-300 text-center leading-relaxed">{steps[step].content}</p>
        <div className="flex justify-center pt-4">
          <button
            onClick={handleNext}
            className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-8 rounded-full transition-colors"
          >
            {step === steps.length - 1 ? "Let's Go!" : 'Next'}
          </button>
        </div>
        <div className="flex justify-center items-center space-x-2">
          {steps.map((_, index) => (
            <div
              key={index}
              className={`w-2 h-2 rounded-full ${
                index === step ? 'bg-purple-500' : 'bg-gray-600'
              }`}
            ></div>
          ))}
        </div>
      </div>
    </div>
  );
};
