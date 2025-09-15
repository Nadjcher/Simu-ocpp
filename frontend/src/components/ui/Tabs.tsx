import React from 'react';
import { clsx } from 'clsx';

interface TabsProps {
    value: string;
    onValueChange: (value: string) => void;
    children: React.ReactNode;
}

export function Tabs({ value, onValueChange, children }: TabsProps) {
    return (
        <div>
            {React.Children.map(children, child => {
                if (React.isValidElement(child)) {
                    return React.cloneElement(child, { value, onValueChange } as any);
                }
                return child;
            })}
        </div>
    );
}

export function TabsList({ children, className }: { children: React.ReactNode; className?: string }) {
    return <div className={clsx('flex', className)}>{children}</div>;
}

interface TabsTriggerProps {
    value: string;
    children: React.ReactNode;
    className?: string;
}

export function TabsTrigger({ value, children, className }: TabsTriggerProps & { value?: string; onValueChange?: (v: string) => void }) {
    const parentProps = (arguments[0] as any);
    const isActive = parentProps.value === value;

    return (
        <button
            className={clsx(
                'px-4 py-2 rounded-lg transition-colors',
                isActive ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600',
                className
            )}
            onClick={() => parentProps.onValueChange?.(value)}
        >
            {children}
        </button>
    );
}

export function TabsContent({ value, children }: { value: string; children: React.ReactNode } & any) {
    const parentProps = arguments[0];
    if (parentProps.value !== value) return null;
    return <>{children}</>;
}