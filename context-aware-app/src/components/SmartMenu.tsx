export const SmartMenu = ({ items }: { items: any[] }) => {
    return (
        <div className="fixed bg-gray-900/90 backdrop-blur-lg border border-gray-700 rounded-xl overflow-hidden shadow-2xl min-w-[300px]">
            {items.map((item, idx) => (
                <div key={idx} className="p-3 hover:bg-gray-800 cursor-pointer flex items-center gap-3 text-white border-b border-gray-800 last:border-0">
                    <span>{item.label || item}</span>
                </div>
            ))}
        </div>
    );
};
