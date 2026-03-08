/**
 * components/FeatureCard.tsx
 *
 * A clickable card displayed on the homepage for each of the six PDF tools.
 * Navigates to the tool's dedicated route when clicked.
 */

import Link from "next/link";
import type { Feature } from "@/utils/constants";

interface FeatureCardProps {
  feature: Feature;
}

export default function FeatureCard({ feature }: FeatureCardProps) {
  return (
    <Link
      href={feature.href}
      className="block rounded-lg border border-gray-200 bg-white p-6 hover:border-gray-400 hover:shadow-sm transition-colors"
    >
      {/* Icon */}
      <div className="mb-3 text-3xl" aria-hidden="true">
        {feature.icon}
      </div>

      {/* Title */}
      <h2 className="mb-1 text-base font-semibold text-gray-900">{feature.title}</h2>

      {/* Description */}
      <p className="text-sm text-gray-600 leading-relaxed">{feature.description}</p>
    </Link>
  );
}
